import type {MetadataRoute} from 'next';
export default function manifest():MetadataRoute.Manifest{return {name:'DCMUN Conference OS',short_name:'Conference OS',description:'Conference operations',start_url:'/chair',display:'standalone',background_color:'#f6f8fb',theme_color:'#245ca6',icons:[{src:'/dcmun-logo.jpg',sizes:'450x451',type:'image/jpeg'}]};}
