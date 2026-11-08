import { IMAGES } from '@/config/brand';

/**
 * Built-in default website content (derived from the original site). Everything here
 * can be overridden WITHOUT code changes: create a page in CMS → Pages with the same
 * slug and publish it. Programmes, navigation, hero and settings are CMS-driven too.
 */
export interface DefaultPage { slug: string; title: string; lead: string; image: string; body: string }

export const DEFAULT_NAV = [
  { label: 'Home', to: '/' },
  { label: 'About', to: '/about' },
  { label: 'Programmes', to: '/programmes' },
  { label: 'Admissions', to: '/admissions' },
  { label: 'Resources', to: '/resources' },
  { label: 'Blog', to: '/blog' },
  { label: 'Contact', to: '/contact' },
];

export const DEFAULT_PAGES: DefaultPage[] = [
  { slug: 'about', title: 'About Episteme Learning Academy', image: IMAGES.classroom,
    lead: 'A learning community built on the belief that true education goes beyond textbooks.',
    body: `<p>Episteme Learning Academy (ELA) exists to nurture the mind, refine character, and guide learners toward purposeful living. Blending academic excellence with moral and spiritual development, we provide a balanced educational experience for children, teenagers and adults in a supportive, learner-centred environment in Ilorin, Kwara State.</p>
<h2>Our approach</h2><ul><li>Small, focused learning groups</li><li>Integration of academic excellence and moral development</li><li>Flexible learning options: physical, online and hybrid</li><li>Personalised mentorship and academic guidance</li><li>A safe, value-driven learning environment</li><li>Modern digital skills training for the future</li></ul>
<h2>Meet the founder</h2><p>Episteme Learning Academy was founded by Salman Abdullateef O., a graduate of the University of Ilorin and Markazi Nabiyyi Arabic and Islamic Learning Center with a background in Plant Biology and a deep passion for educational development. Driven by the belief that true education shapes both intellect and character, he established Episteme to provide balanced learning rooted in knowledge, discipline and moral clarity.</p>` },
  { slug: 'vision-mission', title: 'Vision and Mission', image: IMAGES.learning,
    lead: 'Where Learning Meets Morality.',
    body: `<h2>Our vision</h2><p>To raise confident, morally grounded, and intellectually curious learners who are equipped to thrive academically, think critically, and contribute positively to society.</p>
<h2>Our mission</h2><ul><li>Deliver quality, flexible, and engaging education.</li><li>Integrate academic learning with values and character development.</li><li>Support learners at their own pace.</li><li>Make education accessible, practical, and meaningful.</li></ul>` },
  { slug: 'philosophy', title: 'Educational Philosophy', image: IMAGES.holistic,
    lead: 'Knowledge + Skills + Character + Contribution.',
    body: `<p>At Episteme, learning is holistic. Education should develop the mind, shape character, and prepare learners for real-life challenges, not just exams. We teach with patience, clarity, and intention, meeting learners where they are and guiding them toward growth.</p>
<h2>Four pillars</h2><ul><li><strong>Knowledge</strong> — strong academic foundations and curiosity.</li><li><strong>Skills</strong> — practical, digital and communication skills.</li><li><strong>Character</strong> — honesty, discipline, respect and responsibility.</li><li><strong>Contribution</strong> — learners who serve their families and society.</li></ul>` },
  { slug: 'early-years-primary', title: 'Early Years and Primary', image: IMAGES.classroom,
    lead: 'Structured foundations for the youngest learners.',
    body: `<p>Our Early Childhood and Primary programmes build literacy, numeracy, general knowledge and good habits in small groups, with physical, online or hybrid options. Learners can add Islamic studies, coding and creative skills.</p><p>Admission is open for Preschool, Kindergarten and Grades 1–5. Use the admissions page to enquire.</p>` },
  { slug: 'secondary-education', title: 'Secondary Education', image: IMAGES.curriculum,
    lead: 'Junior and senior secondary pathways with mentorship.',
    body: `<p>We support learners from Junior Secondary (JSS 1–3) through Senior Secondary (SS 1–3) with conventional subjects including Mathematics, English, Basic Science, Biology, Chemistry and Physics, alongside mentorship, study structure and exam preparation.</p>` },
  { slug: 'islamic-education', title: 'Islamic Education', image: IMAGES.islamicStudy,
    lead: 'Comprehensive Islamic education that nurtures knowledge and character.',
    body: `<ul><li>Qur’an memorisation and recitation with Tajweed</li><li>Tawheed, Hadith and Fiqh</li><li>Arabic language</li><li>Seerah and Tafseer</li><li>Adab and Islamic manners</li></ul><p>Islamic studies is available for families who desire moral and spiritual training alongside academics. Online and onsite Hifdh and Tajweed classes are offered.</p>` },
  { slug: 'ict-digital-skills', title: 'ICT and Digital Skills', image: IMAGES.digitalHub,
    lead: 'Hands-on digital skills for modern learning and creativity.',
    body: `<ul><li>Computer basics and operations</li><li>Introduction to graphic design</li><li>Practical digital creativity</li></ul><p>Learners also use the Episteme Digital Learning Hub (LMS) for lessons, quizzes and assignments.</p>` },
  { slug: 'ela-ignite', title: 'ELA Ignite', image: IMAGES.skills,
    lead: 'Skills and capacity development that ignite potential.',
    body: `<p>ELA Ignite brings together our practical skills programmes:</p><ul><li>IELTS preparation</li><li>English proficiency training</li><li>Nelson handwriting training</li><li>Mentorship and counselling (ages 7–15)</li></ul><p><em>Administrators: edit this page in CMS → Pages (slug “ela-ignite”) to describe ELA Ignite in your own words.</em></p>` },
  { slug: 'web-development', title: 'Web Development and Coding', image: IMAGES.graphics,
    lead: 'An introduction to modern coding and logical thinking.',
    body: `<ul><li>HTML — web structure</li><li>CSS — web styling</li><li>JavaScript — interactivity</li><li>Python — beginner programming</li></ul><p>Beginner-friendly, project-based classes online or onsite.</p>` },
  { slug: 'privacy-policy', title: 'Privacy Policy', image: '',
    lead: 'How we handle personal information.',
    body: `<p><em>Template — please have this reviewed and edited by the school before publishing changes.</em></p><p>Episteme Learning Academy collects only the information needed to process enquiries, admissions and learning records (names, contact details, academic records). We do not sell personal data. Access to learner records is limited to authorised staff and the learner’s own parents/guardians. To request correction or deletion of your information, email epistemelearninghub@gmail.com.</p>` },
  { slug: 'terms', title: 'Terms and Conditions', image: '',
    lead: 'Terms of use for our website and portals.',
    body: `<p><em>Template — please have this reviewed and edited by the school before publishing changes.</em></p><p>By using this website and portal you agree to use them lawfully, keep your login private, and respect other users. Fees, refunds and cancellations follow the admission agreement: a minimum of 2 weeks to 1 month notice for cancellation, with eligible refunds processed within 2 to 4 weeks after approval.</p>` },
];

export const DEFAULT_PROGRAMMES = [
  { slug: 'academic', title: 'Academic Programmes', summary: 'Early childhood, primary and junior secondary education tailored to each level.', image: IMAGES.classroom, link: '/early-years-primary' },
  { slug: 'islamic', title: 'Islamic Studies', summary: 'Qur’an with Tajweed, Tawheed, Hadith, Fiqh, Arabic, Seerah and Adab.', image: IMAGES.islamicStudy, link: '/islamic-education' },
  { slug: 'coding', title: 'Coding & Programming', summary: 'HTML, CSS, JavaScript and beginner Python.', image: IMAGES.graphics, link: '/web-development' },
  { slug: 'ict', title: 'ICT & Graphics Design', summary: 'Computer basics, graphic design and practical digital creativity.', image: IMAGES.digitalHub, link: '/ict-digital-skills' },
  { slug: 'skills', title: 'Skills & Capacity Development', summary: 'IELTS preparation, English proficiency and Nelson handwriting.', image: IMAGES.ielts, link: '/ela-ignite' },
  { slug: 'mentorship', title: 'Mentorship & Counselling', summary: 'Holistic mentorship for ages 7–15: character, confidence and motivation.', image: IMAGES.mentorship, link: '/ela-ignite' },
  { slug: 'consultation', title: 'Educational Consultation', summary: 'Academic planning, learning-challenge assessment and study strategies.', image: IMAGES.consultation, link: '/contact' },
  { slug: 'curriculum', title: 'Curriculum Development', summary: 'Lesson planning support, curriculum structuring and content development.', image: IMAGES.curriculum, link: '/contact' },
];

export const DEFAULT_FAQ = [
  { q: 'What age groups do you admit?', a: 'We admit learners from Early Childhood through Junior Secondary level, and offer adult skills classes.' },
  { q: 'Do you offer online classes?', a: 'Yes. We provide physical, online and hybrid learning options.' },
  { q: 'Is Islamic Studies compulsory?', a: 'Islamic Studies is available for families who desire moral and spiritual training alongside academics.' },
  { q: 'How can I apply?', a: 'Use the Admissions page to submit an enquiry. Our team will contact you by phone or WhatsApp.' },
  { q: 'How do I contact the school?', a: 'Call or WhatsApp 09131331867 or 09128732396, or email epistemelearninghub@gmail.com.' },
];

export const CLASS_LEVELS = ['Preschool', 'Kindergarten', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'JSS 1', 'JSS 2', 'JSS 3', 'SS 1', 'SS 2', 'SS 3', 'Adult'];
export const PROGRAMME_CHOICES = ['Mathematics / Numeracy', 'English / Literacy', 'Basic Science', 'Biology', 'Chemistry', 'Physics', 'Islamic Studies (Qur’an, Tajweed, Hadith, Fiqh)', 'Arabic', 'Coding & Programming', 'Graphics Design', 'Computer Appreciation', 'IELTS / English proficiency', 'Counselling / Mentorship'];
