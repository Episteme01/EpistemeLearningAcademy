/**
 * CENTRAL BRAND CONFIGURATION
 * ---------------------------------------------------------------------------
 * To change the logo, replace the files in  public/brand/  (keep the filenames)
 * or edit the paths below. Every page, portal, report card and favicon reads
 * from here. The CMS (Settings → Branding) can also override name/tagline/logo
 * at runtime via the Firestore `settings/site` document.
 */
const BASE = import.meta.env.BASE_URL; // "/Episteme-Learning-Academy/" on GitHub Pages

export const asset = (path: string) => `${BASE}${path.replace(/^\//, '')}`;

export const BRAND = {
  name: 'Episteme Learning Academy',
  shortName: 'ELA',
  motto: 'Where Learning Meets Morality',
  philosophy: ['Knowledge', 'Skills', 'Character', 'Contribution'],
  location: 'Ilorin, Kwara State, Nigeria',
  email: 'epistemelearninghub@gmail.com',
  phones: ['09131331867', '09128732396'],
  whatsapp: '2349131331867', // international format for wa.me
  website: 'https://episteme01.github.io/Episteme-Learning-Academy',
  /** One central place for brand images. Replace the files, keep the names. */
  logo: asset('brand/logo.png'),
  signature: asset('brand/signature.png'),
  stamp: asset('brand/stamp.png'),
  social: {
    facebook: '',
    instagram: '',
    youtube: '',
    tiktok: '',
  },
} as const;

export const IMAGES = {
  hero: asset('images/hero.png'),
  classroom: asset('images/classroom.jpg'),
  founder: asset('images/founder.jpg'),
  consultation: asset('images/consultation.jpg'),
  mentorship: asset('images/mentorship.png'),
  islamicStudy: asset('images/islamic-study.jpg'),
  digitalHub: asset('images/digital-hub.jpg'),
  curriculum: asset('images/curriculum.jpg'),
  skills: asset('images/skills.jpg'),
  ielts: asset('images/ielts.jpg'),
  holistic: asset('images/holistic.jpg'),
  flexible: asset('images/flexible.jpg'),
  integrating: asset('images/integrating.png'),
  graphics: asset('images/graphics.png'),
  learning: asset('images/learning.jpg'),
  icons: {
    facebook: asset('images/facebook-icon.png'),
    instagram: asset('images/instagram-icon.png'),
    youtube: asset('images/youtube-icon.png'),
    tiktok: asset('images/tikok-app-logo.png'),
    whatsapp: asset('images/whatsapp-logo-png-icon_16716480.png'),
  },
} as const;

export const whatsappLink = (text?: string) =>
  `https://wa.me/${BRAND.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
