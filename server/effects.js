// The server chooses only named, locally implemented effects. No shell commands.
const effects = ['boo_file', 'ghost_comment', 'desktop_gif'];
let next = 0;
exports.chooseEffect = () => effects[next++ % effects.length];
