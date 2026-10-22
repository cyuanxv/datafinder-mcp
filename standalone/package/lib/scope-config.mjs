const demo=process.env.DATAFINDER_DEMO==='true';
function id(key,fallback){const v=demo?fallback:process.env[key];if(!/^[1-9][0-9]*$/.test(v??''))throw Error('Missing or invalid '+key);return v;}
export const PROJECT=id('DATAFINDER_PROJECT_ID','1000001');
export const APP=id('DATAFINDER_APP_ID','1000002');
export const SUBJECT=Number(id('DATAFINDER_SUBJECT_ID','1'));
if(!Number.isSafeInteger(SUBJECT))throw Error('Invalid subject');
export const DASHBOARD='8900000000000000006';
export const REPORTS=Object.freeze({});
export const PUBLIC_BASE_URL=process.env.DATAFINDER_LOCAL_BASE_URL??'http://127.0.0.1:4179';
const origin=new URL(PUBLIC_BASE_URL);
if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||!origin.port||origin.pathname!=='/')throw Error('Export origin must be loopback');
