const fs = require('fs');
const path = 'c:/Users/gerar/Desktop/mi-streamdeck/frontend/app.js';
let content = fs.readFileSync(path, 'utf8');

// Fix Mixer updateUI
content = content.replace(/const ty = -\(p \/ 100\) \* trackH;\s+fill\.style\.transform = `scale3d\(1, \${p \/ 100}, 1\)`;\s+thumb\.style\.transform = `translate3d\(-50%, \${ty}px, 0\)`;/g, 
    'fill.style.transform = `scale3d(1, ${p / 100}, 1)`;\n                    thumb.style.bottom = `${p}%`;');

// Fix Discord updateDiscordVol
content = content.replace(/const ty = -\(p \/ 100\) \* trackH;\s+fill\.style\.transform = `scale3d\(1, \${p \/ 100}, 1\)`;\s+thumb\.style\.transform = `translate3d\(-50%, \${ty}px, 0\)`;/g, 
    'fill.style.transform = `scale3d(1, ${p / 100}, 1)`;\n                            thumb.style.bottom = `${p}%`;');

// Fix Domotica updateFader
content = content.replace(/const ty = -\(p \/ 100\) \* trackH;\s+faderFill\.style\.transform = `scale3d\(1, \${p \/ 100}, 1\)`;\s+faderThumb\.style\.transform = `translate3d\(-50%, \${ty}px, 0\)`;/g, 
    'faderFill.style.transform = `scale3d(1, ${p / 100}, 1)`;\n                        faderThumb.style.bottom = `${p}%`;');

// Fix updateSliderUI
content = content.replace(/const ty = -\(h \/ 100\) \* trackHeight;\s+refs\.fill\.style\.transform = `scale3d\(1, \${h \/ 100}, 1\)`;\s+refs\.thumb\.style\.transform = `translate3d\(-50%, \${ty}px, 0\)`;/g, 
    'refs.fill.style.transform = `scale3d(1, ${h / 100}, 1)`;\n                    refs.thumb.style.bottom = `${h}%`;');

fs.writeFileSync(path, content);
console.log('App.js fixed successfully');
