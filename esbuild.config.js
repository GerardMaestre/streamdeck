const esbuild = require('esbuild');
const path = require('path');

const isWatch = process.argv.includes('--watch');

const buildOptions = {
    entryPoints: [path.join(__dirname, 'frontend', 'src', 'main.js')],
    bundle: true,
    outfile: path.join(__dirname, 'frontend', 'dist', 'app.bundle.js'),
    format: 'iife',
    target: ['es2020'],
    minify: !isWatch,
    sourcemap: isWatch ? 'inline' : false,
    logLevel: 'info',
};

async function run() {
    if (isWatch) {
        const ctx = await esbuild.context(buildOptions);
        await ctx.watch();
        console.log('[esbuild] Watching for changes...');
    } else {
        await esbuild.build(buildOptions);
        console.log('[esbuild] Build complete.');
    }
}

run().catch((err) => {
    console.error('[esbuild] Build failed:', err);
    process.exit(1);
});
