import { Navigate, Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import SignUp from './pages/SignUp.jsx'
import Login from './pages/Login.jsx'
import ForgotPin from './pages/ForgotPin.jsx'
import Home from './pages/Home.jsx'
import Profile from './pages/Profile.jsx'
import EditProfile from './pages/EditProfile.jsx'
import ChangePin from './pages/ChangePin.jsx'
import Settings from './pages/Settings.jsx'
import Kolo from './pages/Kolo.jsx'
import Family from './pages/Family.jsx'
import FindHospital from './pages/FindHospital.jsx'
import BookVisit from './pages/BookVisit.jsx'
import Hospital from './pages/Hospital.jsx'
import HospitalHome from './pages/HospitalHome.jsx'
import HospitalStats from './pages/HospitalStats.jsx'
import HospitalSettings from './pages/HospitalSettings.jsx'
import NowServing from './pages/NowServing.jsx'
import Admin from './pages/Admin.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/signup" element={<SignUp />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-pin" element={<ForgotPin />} />
      <Route path="/home" element={<Home />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/profile/edit" element={<EditProfile />} />
      <Route path="/profile/pin" element={<ChangePin />} />
      <Route path="/account" element={<Navigate to="/profile" replace />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/book" element={<FindHospital />} />
      <Route path="/book/:clinicId" element={<BookVisit />} />
      <Route path="/kolo" element={<Kolo />} />
      <Route path="/family" element={<Family />} />
      <Route path="/hospital" element={<Hospital key="register" mode="register" />} />
      <Route path="/hospital/login" element={<Hospital key="login" mode="login" />} />
      <Route path="/hospital/home" element={<HospitalHome />} />
      <Route path="/hospital/stats" element={<HospitalStats />} />
      <Route path="/hospital/settings" element={<HospitalSettings />} />
      <Route path="/screen/:clinicId" element={<NowServing />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
