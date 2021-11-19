/* eslint-disable no-console */

import { Peers } from '@cloudpss/peers';

const room = 'pUCql7PGdLqCikQ4q2ep28o_ZzmKYkMcx6009TRO87-NJDTKgVpwWI0MReUwsLOP';

export const p1 = new Peers({
    label: 'p1',
    url: 'https://dogfood.local.cloudpss.net',
    token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NCwidXNlcm5hbWUiOiJhYWEiLCJzY29wZXMiOlsidW5rbm93biJdLCJ0eXBlIjoiYnJvd3NlciIsImV4cCI6MTYzODU4ODg4MiwiaWF0IjoxNjM1OTEwNDgyfQ.gk3mximwqghNyPgEKyBAbB4Ooqs1ZJC_MnBGsj1zDNECoSKsBJicGVwe6wK-wKRxRT1NcbyRS9_R-sWIcZj2I2Bgtlodk_Uxps33292roCTWRDbvAr_o2z-WSsGetn-Bjm06Yy0nB99t_3xScIsx9IOp-XP8UQhjGYrtJIW95Us',
    room,
});
export const p2 = new Peers({
    label: 'p2',
    url: 'https://dogfood.local.cloudpss.net',
    token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6NCwidXNlcm5hbWUiOiJhYWEiLCJzY29wZXMiOlsidW5rbm93biJdLCJ0eXBlIjoiYnJvd3NlciIsImV4cCI6MTYzODU4ODg4MiwiaWF0IjoxNjM1OTEwNDgyfQ.gk3mximwqghNyPgEKyBAbB4Ooqs1ZJC_MnBGsj1zDNECoSKsBJicGVwe6wK-wKRxRT1NcbyRS9_R-sWIcZj2I2Bgtlodk_Uxps33292roCTWRDbvAr_o2z-WSsGetn-Bjm06Yy0nB99t_3xScIsx9IOp-XP8UQhjGYrtJIW95Us',
    room,
});

p1.data.subscribe(console.log);
p2.data.subscribe(console.log);
