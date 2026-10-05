'use client';
import {useEffect} from 'react';
export function OfflineShell(){
 useEffect(()=>{
  if(process.env.NODE_ENV==='production' && 'serviceWorker' in navigator){
   void navigator.serviceWorker.register('/sw.js').catch(()=>{/* Health docs explain first-online preparation. */});
  }
 },[]);
 return null;
}
