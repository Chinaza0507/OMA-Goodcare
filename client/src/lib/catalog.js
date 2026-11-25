// Shared lists. ỌMA starts in Lagos, so state is Lagos and areas are Lagos areas.
export const STATE = 'Lagos'
export const LAGOS_AREAS = [
  'Agege', 'Ajah', 'Alimosho', 'Apapa', 'Badagry', 'Ebute Metta', 'Egbeda', 'Epe', 'Festac', 'Gbagada',
  'Ikeja', 'Ikorodu', 'Ikoyi', 'Ilupeju', 'Isolo', 'Ketu', 'Lagos Island', 'Lekki', 'Magodo', 'Maryland',
  'Mushin', 'Ogba', 'Ojo', 'Ojota', 'Oshodi', 'Sangotedo', 'Surulere', 'Victoria Island', 'Yaba',
]
// Common services patients look for. Hospitals can name their own too.
export const COMMON_SERVICES = [
  'General consultation', 'Check-up', 'Blood pressure check', 'Blood test', 'Malaria test', 'Typhoid test',
  'Immunisation', 'Child check-up', 'Postnatal visit', 'Family planning', 'Ultrasound scan',
  'X-ray', 'ECG', 'Physiotherapy', 'Dermatology (skin)', 'ENT (ear, nose, throat)', 'Mental health consultation',
  'Teeth cleaning', 'Tooth filling', 'Tooth extraction', 'Root canal', 'Braces fitting', 'Braces adjustment', 'Teeth whitening',
  'Eye test', 'Glasses fitting', 'Contact lens fitting', 'Eye pressure test',
]
// Loose match so "Cleaning" finds "Teeth cleaning" and the other way round.
export const sameService = (a, b) => {
  const x = a.toLowerCase().trim()
  const y = b.toLowerCase().trim()
  return x === y || x.includes(y) || y.includes(x)
}
