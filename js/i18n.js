const translations = {
  fr: {
    search_placeholder: 'indicatif, immatriculation ou code aéroport…',
    status_connecting: 'CONNEXION…',
    status_updating: 'MISE À JOUR…',
    status_live: 'EN DIRECT',
    status_error: 'ERREUR API',
    status_not_tracked: 'PAS ENCORE SUIVI',
    status_age: (n) => `EN DIRECT · ${n} s`,
    zone_label: 'ZONE',
    zone_searching: 'RECHERCHE DE ',
    stat_tracked: 'VOLS SUIVIS',
    stat_cycles: 'ZONES EXPLORÉES',
    btn_zones: 'ZONES',
    btn_filters: 'FILTRES',
    btn_resume: 'REPRENDRE LA ROTATION MONDIALE',
    zones_title: 'Explorer un continent',
    cont_europe: 'Europe',
    cont_me: 'Moyen-Orient',
    cont_africa: 'Afrique',
    cont_asia: 'Asie',
    cont_oceania: 'Océanie',
    cont_na: 'Amérique du Nord',
    cont_sa: 'Amérique du Sud',
    filter_alt_min: 'Altitude min (m)',
    filter_alt_max: 'Altitude max (m)',
    filter_hide_ground: 'Masquer les avions au sol',
    btn_reset: 'RÉINITIALISER',
    lbl_reg: 'Immatriculation',
    lbl_alt: 'Altitude',
    lbl_speed: 'Vitesse',
    lbl_heading: 'Cap',
    lbl_vrate: 'Vitesse vert.',
    lbl_squawk: 'Transpondeur',
    lbl_pos: 'Position',
    btn_follow: 'SUIVRE',
    btn_route: 'TRAJECTOIRE',
    btn_share: 'PARTAGER',
    link_copied: 'LIEN COPIÉ',
    legend_cruise: 'Croisière (&gt;8000m)',
    legend_mid: 'Moyenne altitude',
    legend_low: 'Décollage/atterrissage',
    attribution:
      'Données: airplanes.live · Photos: planespotters.net · Les positions entre deux mises à jour sont estimées',
    map_dark: 'Sombre',
    map_satellite: 'Satellite',
    map_colored: 'Coloré',
    route_points: (n) => `${n} point${n > 1 ? 's' : ''} de trajectoire locale observée`,
    last_update: (n) => `Dernière donnée reçue il y a ${n} seconde${n > 1 ? 's' : ''}`,
  },
  en: {
    search_placeholder: 'callsign, registration or airport code…',
    status_connecting: 'CONNECTING…',
    status_updating: 'UPDATING…',
    status_live: 'LIVE',
    status_error: 'API ERROR',
    status_not_tracked: 'NOT TRACKED YET',
    status_age: (n) => `LIVE · ${n} s`,
    zone_label: 'ZONE',
    zone_searching: 'SEARCHING FOR ',
    stat_tracked: 'FLIGHTS TRACKED',
    stat_cycles: 'ZONES SCANNED',
    btn_zones: 'ZONES',
    btn_filters: 'FILTERS',
    btn_resume: 'RESUME GLOBAL ROTATION',
    zones_title: 'Explore a continent',
    cont_europe: 'Europe',
    cont_me: 'Middle East',
    cont_africa: 'Africa',
    cont_asia: 'Asia',
    cont_oceania: 'Oceania',
    cont_na: 'North America',
    cont_sa: 'South America',
    filter_alt_min: 'Min altitude (m)',
    filter_alt_max: 'Max altitude (m)',
    filter_hide_ground: 'Hide aircraft on the ground',
    btn_reset: 'RESET',
    lbl_reg: 'Registration',
    lbl_alt: 'Altitude',
    lbl_speed: 'Speed',
    lbl_heading: 'Heading',
    lbl_vrate: 'Vert. speed',
    lbl_squawk: 'Squawk',
    lbl_pos: 'Position',
    btn_follow: 'FOLLOW',
    btn_route: 'TRAIL',
    btn_share: 'SHARE',
    link_copied: 'LINK COPIED',
    legend_cruise: 'Cruise (&gt;8000m)',
    legend_mid: 'Mid altitude',
    legend_low: 'Takeoff/landing',
    attribution:
      'Data: airplanes.live · Photos: planespotters.net · Positions between updates are estimated',
    map_dark: 'Dark',
    map_satellite: 'Satellite',
    map_colored: 'Colorful',
    route_points: (n) => `${n} locally observed trajectory point${n > 1 ? 's' : ''}`,
    last_update: (n) => `Last data received ${n} second${n > 1 ? 's' : ''} ago`,
  },
  he: {
    search_placeholder: 'סימן קריאה, מספר רישום או קוד שדה תעופה…',
    status_connecting: 'מתחבר…',
    status_updating: 'מתעדכן…',
    status_live: 'בשידור חי',
    status_error: 'שגיאת API',
    status_not_tracked: 'עדיין לא נמצא',
    status_age: (n) => `בשידור חי · ${n} שנ׳`,
    zone_label: 'אזור',
    zone_searching: 'מחפש את ',
    stat_tracked: 'טיסות במעקב',
    stat_cycles: 'אזורים שנסרקו',
    btn_zones: 'אזורים',
    btn_filters: 'סינון',
    btn_resume: 'חזרה לסריקה עולמית',
    zones_title: 'חקור יבשת',
    cont_europe: 'אירופה',
    cont_me: 'המזרח התיכון',
    cont_africa: 'אפריקה',
    cont_asia: 'אסיה',
    cont_oceania: 'אוקיאניה',
    cont_na: 'צפון אמריקה',
    cont_sa: 'דרום אמריקה',
    filter_alt_min: 'גובה מינימלי (מ׳)',
    filter_alt_max: 'גובה מקסימלי (מ׳)',
    filter_hide_ground: 'הסתר מטוסים על הקרקע',
    btn_reset: 'איפוס',
    lbl_reg: 'מספר רישום',
    lbl_alt: 'גובה',
    lbl_speed: 'מהירות',
    lbl_heading: 'כיוון',
    lbl_vrate: 'קצב עלייה/ירידה',
    lbl_squawk: 'משיב מכ״ם',
    lbl_pos: 'מיקום',
    btn_follow: 'עקוב',
    btn_route: 'מסלול שנצפה',
    btn_share: 'שיתוף',
    link_copied: 'הקישור הועתק',
    legend_cruise: 'טיסת שיוט (מעל 8000מ׳)',
    legend_mid: 'גובה בינוני',
    legend_low: 'המראה/נחיתה',
    attribution:
      'נתונים: airplanes.live · תמונות: planespotters.net · המיקומים בין עדכונים הם הערכה',
    map_dark: 'כהה',
    map_satellite: 'לוויין',
    map_colored: 'צבעוני',
    route_points: (n) => `${n} נקודות מסלול מקומיות שנצפו`,
    last_update: (n) => `הנתון האחרון התקבל לפני ${n} שניות`,
  },
};

let currentLanguage = localStorage.getItem('skytrace_lang') || 'fr';

export function t(key, ...args) {
  const value =
    (translations[currentLanguage] || translations.fr)[key] ?? translations.fr[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

export function getLanguage() {
  return currentLanguage;
}

export function applyLanguage(language) {
  currentLanguage = translations[language] ? language : 'fr';
  localStorage.setItem('skytrace_lang', currentLanguage);
  document.documentElement.lang = currentLanguage;
  document.documentElement.dir = currentLanguage === 'he' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.innerHTML = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  document
    .querySelectorAll('.lang-btn')
    .forEach((button) =>
      button.classList.toggle('active', button.dataset.lang === currentLanguage)
    );
  document.dispatchEvent(new CustomEvent('skytrace:languagechange'));
}
