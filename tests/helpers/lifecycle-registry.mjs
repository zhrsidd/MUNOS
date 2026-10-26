// TEST PROCESS ONLY. Never imported by shipping tools or app code. The network-blocking preload loads this fixture so
// positive CLI/unit cases remain synthetic after the real project is promoted. The committed owner record stays unchanged.
import {createRequire} from 'node:module';
export const TEST_PROJECT_REF='testtesttesttesttest';
export const testRegistry=createRequire(import.meta.url)('../../config/project-lifecycle.json');
if(Object.hasOwn(testRegistry.projects,TEST_PROJECT_REF))throw Error('The synthetic test ref must not be in the owner lifecycle record');
testRegistry.projects[TEST_PROJECT_REF]={phase:'preproduction'};
