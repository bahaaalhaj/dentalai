import React from 'react';
import { motion } from 'framer-motion';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { Activity, Shield, Clock, Heart, ArrowRight, Star, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';



export function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="fixed top-0 w-full bg-white/80 backdrop-blur-md z-50 border-bottom border-slate-100">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
              <Shield className="text-white w-6 h-6" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">DentalAi</span>
          </div>
          <nav className="hidden md:flex items-center gap-8">
            <a href="#services" className="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors">Services</a>
            <a href="#about" className="text-sm font-medium text-slate-600 hover:text-indigo-600 transition-colors">About</a>
            <Link to="/login" className="px-6 py-2.5 bg-slate-900 text-white rounded-full text-sm font-medium hover:bg-slate-800 transition-all">
              Login
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 text-indigo-600 text-xs font-bold uppercase tracking-wider mb-6">
              <Activity className="w-3 h-3" />
              Smart Dental Care
            </div>
            <h1 className="text-6xl md:text-7xl font-bold text-slate-900 leading-[1.1] mb-6 tracking-tight">
              Welcome to <span className="text-indigo-600">DentalAi</span>
            </h1>
            <p className="text-xl text-slate-600 mb-10 leading-relaxed max-w-xl">
              Experience the future of dentistry. AI-powered diagnostics, interactive treatment planning, and seamless care management.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Link to="/register" className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-semibold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-200 flex items-center justify-center gap-2 group">
                Book Appointment
                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a href="#services" className="px-8 py-4 bg-white border border-slate-200 text-slate-900 rounded-2xl font-semibold hover:bg-slate-50 transition-all flex items-center justify-center gap-2">
                View Services
              </a>
            </div>
          </motion.div>
          
          <motion.div whileHover={{ scale: 1.05 }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative flex justify-center"
          >
            <div className="absolute inset-0 bg-indigo-400/10 blur-[120px] rounded-full" />

          <DotLottieReact
              src="/animations/Cleantooth.json"
              loop
              autoplay
              className="w-full max-w-lg lg:max-w-xl"
              speed={0.8}
          />
          </motion.div>
        </div>
      </section>

      {/* Scrolling Banner */}
      <section className="py-12 bg-white border-y border-slate-100 overflow-hidden">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-4xl font-bold text-slate-900 mb-4">some of dental treatments in clinic</h2>
            <p className="text-slate-600">Meticulous work and guaranteed treatment under the supervision of elite doctors , using the finest technologies and tools.</p>
          </div>
        <div className="relative flex">
          <motion.div
            className="flex gap-12 items-center whitespace-nowrap"
            animate={{ x: ["-50%", "0%"] }}
            transition={{
              duration: 20,
              ease: "linear",
              repeat: Infinity,
            }}
          >
            {/* First set of 4 images */}
            {['img1.jpg', 'img2.jpg', 'img3.jpg', 'img4.jpg'].map((img, i) => (
              <div key={`banner-1-${i}`} className="w-64 h-32 shrink-0 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200">
                <img
                  src={`/pics/${img}`}
                  alt={`Clinic Partner ${i + 1}`}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              </div>
            ))}
            {/* Second set of 4 images for seamless loop */}
            {['img5.jpg', 'img6.jpg', 'img7.jpg', 'img8.jpg'].map((img, i) => (
              <div key={`banner-2-${i}`} className="w-64 h-32 shrink-0 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200">
                <img
                  src={`/pics/${img}`}
                  alt={`Clinic Partner ${i + 1}`}
                  className="w-full h-full object-cover "
                  referrerPolicy="no-referrer"
                />
              </div>
            ))}
          </motion.div>
        </div>
      </section>


      {/* Services */}
      <section id="services" className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-4xl font-bold text-slate-900 mb-4">Our Smart Services</h2>
            <p className="text-slate-600">Combining clinical excellence with cutting-edge artificial intelligence to provide the best care.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: Shield, title: "AI X-Ray Analysis", desc: "Instant detection of cavities and infections using our proprietary AI models." },
              { icon: Clock, title: "Smart Scheduling", desc: "Automated reminders and easy online booking for your convenience." },
              { icon: Heart, title: "Personalized Care", desc: "Tailored treatment plans based on your unique dental history." }
            ].map((s, i) => (
              <motion.div
                key={i}
                whileHover={{ y: -5 }}
                className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm"
              >
                <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mb-6">
                  <s.icon className="w-7 h-7 text-indigo-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-3">{s.title}</h3>
                <p className="text-slate-600 leading-relaxed">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer id="about" className="bg-slate-900 text-white py-20">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
                <Shield className="text-white w-6 h-6" />
              </div>
              <span className="text-2xl font-bold tracking-tight">DentalAi</span>
            </div>
            <p className="text-slate-400 max-w-sm mb-8">
              Leading the way in digital dentistry. Providing smart, secure, and compassionate care for your smile.
            </p>
          </div>
          <div>
            <h4 className="font-bold mb-6">Contact</h4>
            <ul className="space-y-4 text-slate-400 text-sm">
              <li>Yabroud , Damascus suburb</li>
              <li>+963 999 777 444</li>
              <li>care@dentalai.com</li>
            </ul>
          </div>
          <div>
            <h4 className="font-bold mb-6">Hours</h4>
            <ul className="space-y-4 text-slate-400 text-sm">
              <li>Sat - Thu: 8:00 AM - 5:00 PM</li>
              <li>Friday: Closed</li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-20 pt-8 border-t border-white/10 text-center text-slate-500 text-sm">
          © 2026 DentalAi. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
