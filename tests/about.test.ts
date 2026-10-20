import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import AboutPage from '../app/about/page';
import {isPublicPath} from '../components/conference-shell';
import {BRAND,PLATFORM} from '../lib/brand';

test('About is public, credits the creator and contributor, and keeps the DCMUN identity separate',()=>{
 assert.equal(isPublicPath('/about'),true,'no staff session or device storage');
 assert.equal(isPublicPath('/about/x'),false);
 const html=renderToStaticMarkup(createElement(AboutPage));
 for(const text of ['Zuhayr Siddique','John Paul Ribeiru','Development Contributor','Doha College Model United Nations','proprietary software','SIL Open Font License'])assert.ok(html.includes(text),text);
 assert.ok(html.includes(PLATFORM.creatorUrl)&&html.includes(PLATFORM.contributors[0].url));
 assert.ok(html.includes('rel="noopener noreferrer"'));
 assert.ok(!/PHESMUN|Park House/i.test(html),'no PHESMUN identity');
 assert.equal(BRAND.logo,'/dcmun-logo.jpg');
});
