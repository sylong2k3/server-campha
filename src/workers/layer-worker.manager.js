'use strict';

const path = require('path');
const { fork } = require('child_process');

let child = null;
let stopping = false;

const isEnabled = () => process.env.LAYER_WORKER_ENABLED === 'true';

const start = () => {
    if (!isEnabled() || child) {
        return;
    }
    stopping = false;
    child = fork(path.join(__dirname, 'layer-import.worker.js'), [], {
        env: process.env,
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        windowsHide: true,
    });
    child.once('exit', (code, signal) => {
        child = null;
        if (!stopping) {
            console.error(`[LayerWorker] exited code=${code} signal=${signal}; restarting`);
            setTimeout(start, 5000).unref?.();
        }
    });
};

const stop = (timeoutMs = 10000) =>
    new Promise((resolve) => {
        stopping = true;
        if (!child) {
            resolve();
            return;
        }
        const target = child;
        let settled = false;
        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            target.removeListener('exit', finish);
            resolve();
        };
        const timer = setTimeout(() => {
            target.kill('SIGTERM');
            finish();
        }, timeoutMs);
        timer.unref?.();
        target.once('exit', finish);
        target.send({ type: 'stop' });
    });

module.exports = { isEnabled, start, stop };
