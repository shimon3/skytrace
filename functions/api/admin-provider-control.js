import {
  isKnownProvider,
  readAllProviderControls,
  readProviderControl,
  writeProviderControl,
} from '../lib/provider-controls.js';
import { recordProviderRequest } from '../lib/stats.js';

const POSITION_PROVIDERS = new Set(['opensky', 'adsb.fi', 'adsb.lol', 'airlabs']);
const TEST_TIMEOUT_MS = 10000;
const TOKEN_TIMEOUT_MS = 8000;
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store, private','x-content-type-options':'nosniff'}});}
function constantTimeEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let mismatch=0;for(let i=0;i<a.length;i+=1)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);return mismatch===0;}
function authorized(context){const configured=context.env?.ADMIN_STATS_TOKEN;if(!configured)return {ok:false,status:503,error:'ADMIN_NOT_CONFIGURED'};const auth=context.request.headers.get('authorization')||'',supplied=auth.startsWith('Bearer ')?auth.slice(7):'';if(!constantTimeEqual(supplied,configured))return {ok:false,status:401,error:'UNAUTHORIZED'};return {ok:true};}

async function getOpenSkyToken(env,origin){
  const clientId=String(env?.OPENSKY_CLIENT_ID||'').trim(),clientSecret=String(env?.OPENSKY_CLIENT_SECRET||'').trim();
  if(!clientId||!clientSecret)return {error:'OPENSKY_OAUTH_NOT_CONFIGURED',status:503};
  const cache=caches.default,key=new Request(`${origin}/__skytrace_opensky_oauth_token_v2`),cached=await cache.match(key);
  if(cached){const token=await cached.text();if(token)return {token,source:'cache'};}
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),TOKEN_TIMEOUT_MS);
  try{
    const response=await fetch(OPENSKY_TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body:new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:clientSecret}),signal:controller.signal});
    const text=await response.text(),payload=(()=>{try{return JSON.parse(text);}catch{return null;}})();
    if(!response.ok)return {error:'OPENSKY_TOKEN_FAILED',status:response.status,detail:payload?.error_description||payload?.error||text.slice(0,160)||null};
    const token=String(payload?.access_token||'').trim();if(!token)return {error:'OPENSKY_TOKEN_MISSING',status:502};
    const expires=Math.max(60,Math.min(1500,(Number(payload?.expires_in)||1800)-120));
    await cache.put(key,new Response(token,{headers:{'cache-control':`public, max-age=${expires}`}}));
    return {token,source:'oauth'};
  }catch(error){const timedOut=error instanceof Error&&error.name==='AbortError';return {error:timedOut?'OPENSKY_TOKEN_TIMEOUT':'OPENSKY_TOKEN_NETWORK_ERROR',status:timedOut?598:599,detail:error instanceof Error?error.message:String(error)};}finally{clearTimeout(timeout);}
}

async function providerTestRequest(context,provider,origin){
  if(provider==='opensky'){
    const auth=await getOpenSkyToken(context.env,origin);
    const params=new URLSearchParams({lamin:'29.5',lomin:'32.5',lamax:'33.5',lomax:'36.0'});
    // OpenSky documents anonymous REST access with reduced credits. If the OAuth
    // host is unreachable from the Cloudflare edge, test the REST path anonymously
    // instead of falsely reporting that the whole OpenSky service is down.
    return {url:`https://opensky-network.org/api/states/all?${params}`,headers:{accept:'application/json',...(auth.token?{authorization:`Bearer ${auth.token}`}:{})},payloadArray:'states',authMode:auth.token?'oauth':'anonymous-fallback',oauthError:auth.token?null:{code:auth.error,status:auth.status,detail:auth.detail||null}};
  }
  if(provider==='adsb.fi')return {url:'https://opendata.adsb.fi/api/v3/lat/31.5/lon/34.8/dist/25',headers:{accept:'application/json','user-agent':'SkyTrace/2.6 (+https://skytrace-83z.pages.dev)'},payloadArray:'ac'};
  if(provider==='adsb.lol')return {url:'https://api.adsb.lol/v2/point/31.5/34.8/25',headers:{accept:'application/json'},payloadArray:'ac'};
  if(provider==='airlabs'){const apiKey=String(context.env?.AIRLABS_API_KEY||'').trim();if(!apiKey)return {error:'NOT_CONFIGURED',status:503};const params=new URLSearchParams({bbox:'29.5,32.5,33.5,36.0',_view:'object',_fields:'hex,lat,lng,updated',api_key:apiKey});return {url:`https://airlabs.co/api/v9/flights?${params}`,headers:{accept:'application/json'},payloadArray:'response'};}
  return {error:'UNKNOWN_PROVIDER',status:400};
}
async function safeRecordProviderRequest(context,status,origin,provider){try{await recordProviderRequest(context.env,status,origin,provider);}catch(error){console.error(`admin-provider-control: unable to record stats for ${provider}:`,error instanceof Error?error.message:error);}}
async function testProvider(context,provider,origin){const request=await providerTestRequest(context,provider,origin);if(request.error)return {ok:false,status:request.status,code:request.error,detail:request.detail||null};const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),TEST_TIMEOUT_MS);try{const response=await fetch(request.url,{headers:request.headers,signal:controller.signal});const payload=await response.json().catch(()=>null);await safeRecordProviderRequest(context,response.status,origin,provider);const rows=request.payloadArray&&Array.isArray(payload?.[request.payloadArray])?payload[request.payloadArray]:[];return {ok:response.ok,status:response.status,code:response.ok?'OK':'UPSTREAM_HTTP_ERROR',aircraft:rows.length,authMode:request.authMode||null,oauthError:request.oauthError||null};}catch(error){const timedOut=error instanceof Error&&error.name==='AbortError',status=timedOut?598:599;await safeRecordProviderRequest(context,status,origin,provider);return {ok:false,status,code:timedOut?'UPSTREAM_TIMEOUT':'UPSTREAM_NETWORK_ERROR',message:error instanceof Error?error.message:String(error),authMode:request.authMode||null,oauthError:request.oauthError||null};}finally{clearTimeout(timeout);}}
export async function onRequestPost(context){const auth=authorized(context);if(!auth.ok)return json({error:auth.error},auth.status);const origin=new URL(context.request.url).origin,body=await context.request.json().catch(()=>({})),provider=String(body.provider||''),action=String(body.action||'');if(!isKnownProvider(provider))return json({error:'UNKNOWN_PROVIDER'},400);if(action==='test'){const result=await testProvider(context,provider,origin);return json({provider,action,...result});}if(action==='enable'){const control=await writeProviderControl(context.env,provider,{enabled:true,pausedUntil:null,pauseReason:null},origin);return json({provider,control});}if(action!=='pause')return json({error:'INVALID_ACTION'},400);let pausedUntil=body.resumeAt?new Date(body.resumeAt):null;if(pausedUntil&&Number.isNaN(pausedUntil.getTime()))return json({error:'INVALID_RESUME_AT'},400);if(pausedUntil&&pausedUntil.getTime()<=Date.now())return json({error:'INVALID_RESUME_AT'},400);if(pausedUntil&&pausedUntil.getTime()>Date.now()+7*24*60*60*1000)return json({error:'RESUME_AT_TOO_FAR'},400);if(POSITION_PROVIDERS.has(provider)){const controls=await readAllProviderControls(context.env,origin),otherActive=controls.some(item=>POSITION_PROVIDERS.has(item.provider)&&item.provider!==provider&&item.enabled);if(!otherActive)return json({error:'AT_LEAST_ONE_POSITION_PROVIDER_REQUIRED'},409);}const current=await readProviderControl(context.env,provider,origin);if(!pausedUntil&&current.pausedUntil)pausedUntil=new Date(current.pausedUntil);const control=await writeProviderControl(context.env,provider,{enabled:false,pausedUntil:pausedUntil?pausedUntil.toISOString():null,pauseReason:'MANUAL'},origin);return json({provider,control});}
