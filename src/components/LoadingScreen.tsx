import React from 'react';
import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';

export function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-9999">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center"
      >
        <div className="relative mb-6">
          <motion.div
            animate={{ 
              scale: [1, 1.2, 1],
              opacity: [0.5, 1, 0.5]
            }}
            transition={{ 
              repeat: Infinity, 
              duration: 2,
              ease: "easeInOut" 
            }}
            className="absolute inset-0 bg-indigo-500 rounded-full blur-xl opacity-20"
          />
          <div className="bg-indigo-600 p-4 rounded-3xl shadow-xl shadow-indigo-200 relative">
            <Activity className="w-10 h-10 text-white animate-pulse" />
          </div>
        </div>
        
        <h2 className="text-xl font-bold text-slate-900 mb-2">Dental AI</h2>
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{ opacity: [0.2, 1, 0.2] }}
              transition={{ 
                repeat: Infinity, 
                duration: 1, 
                delay: i * 0.2 
              }}
              className="w-1.5 h-1.5 bg-indigo-500 rounded-full"
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}
