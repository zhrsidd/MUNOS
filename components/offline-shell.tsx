'use client';
import {useEffect} from 'react';
export function OfflineShell(){
 useEffect(()=>{
  // Delegate phones on /submit must not pre-cache the staff Chair shell.
  if(process.env.NODE_ENV==='production' && 'serviceWorker' in navigator && !location.pathname.startsWith('/submit/')){
   void navigator.serviceWorker.register('/sw.js').catch(()=>{/* Health docs explain first-online preparation. */});
  }
 },[]);
 return null;
}
