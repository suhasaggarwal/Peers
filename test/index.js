const { Peers } = require('..');
const wrtc = require('wrtc');

const room = 'zqXGiLPkdwbjDRwIyAEzRz6SbWwwy8_gnXK1FL3azFPUEAel35Hdnrypse0wA0lL';

const p1 = new Peers({
    label: 'p1',
    url: 'https://dogfood.local.cloudpss.net',
    token: 'xx',
    room,
    wrtc,
});
const p2 = new Peers({
    label: 'p2',
    url: 'https://dogfood.local.cloudpss.net',
    token: 'xx',
    room,
    wrtc,
});

p1.data.subscribe(console.log);
p2.data.subscribe(console.log);

exports.p1 = p1;
exports.p2 = p2;
