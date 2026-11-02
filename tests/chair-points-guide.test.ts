import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChairPointsGuide } from '../components/chair-points-guide';

test('points guide uses the committee override and the configured choices rather than an invented continuous range', () => {
 const html=renderToStaticMarkup(createElement(ChairPointsGuide,{committeeId:'ga1',data:{scoring:[{id:'speech',label:'Speech',values:[2,4,7]}],committees:[{id:'ga1',conferenceId:'conf',code:'GA1',name:'GA1',room:'A',scoringOverrides:[{id:'poi',label:'POI',values:[0,3]},{id:'submitter',label:'Main Submitter',values:[8]}]}]}}));
 for(const value of ['2 / 4 / 7','0 / 3','>8<','Main Submitter credit is automatic once per resolution','Amendment credit: award in Participation.']) assert.ok(html.includes(value),value);
 assert.doesNotMatch(html,/<details open/,'collapsed reference leaves the floor unobstructed');
});
