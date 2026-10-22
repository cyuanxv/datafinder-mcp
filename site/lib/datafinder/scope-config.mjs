// Fictional defaults: replace these values before connecting your own tenant.
export const PROJECT = '1000001';
export const APP = '1000002';
export const DASHBOARD = '8900000000000000006';
export const REPORTS = Object.freeze({
  '8900000000000000007': '示例报表', '8900000000000000008': '示例报表',
  '8900000000000000009': '示例报表', '8900000000000000010': '示例报表',
  '8900000000000000011': '示例报表', '8900000000000000012': '示例报表',
  '8900000000000000013': '示例报表',
});
export const SUBJECT = 1;
for (const value of [PROJECT,APP,DASHBOARD,SUBJECT,...Object.keys(REPORTS)]) {
 if (!/^[1-9][0-9]*$/.test(String(value))) throw new Error('Invalid DataFinder scope configuration');
}

export const PUBLIC_BASE_URL = 'https://datafinder.example.invalid';
if (new URL(PUBLIC_BASE_URL).protocol !== 'https:') throw new Error('Public base URL must use HTTPS');
