'use strict';

const crypto = require('crypto');
const repository = require('../repositories/file-cleanup.repository');
const minioService = require('../services/minio.service');

const workerId = `${process.env.HOSTNAME || 'file-cleanup'}-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const leaseSeconds = Math.max(30, Number(process.env.LAYER_WORKER_LEASE_SECONDS || 120));
const missingCodes = new Set(['NoSuchKey', 'NoSuchObject', 'NotFound']);

const processJob = async (job) => {
    const timer = setInterval(
        () =>
            repository
                .heartbeat(job.id, workerId, leaseSeconds)
                .catch((error) => console.error('[FileCleanup] heartbeat:', error.message)),
        Math.max(10000, Math.floor(leaseSeconds * 500)),
    );
    timer.unref?.();
    try {
        const references = await repository.activeReferences(job.file_object_id);
        if (references.length) {
            await repository.block(job, workerId, references);
            return { completed: false, blockedBy: references };
        }
        const file = await repository.findFile(job.file_object_id);
        if (file && file.lifecycle_status === 'ready' && !file.deleted_at) {
            await minioService
                .removeObject({ objectKey: file.object_key, category: file.category })
                .catch((error) => {
                    if (!missingCodes.has(error.code)) {
                        throw error;
                    }
                });
        }
        const completion = await repository.complete(job, workerId);
        if (completion.references.length) {
            return { completed: false, blockedBy: completion.references };
        }
        return { completed: completion.completed };
    } catch (error) {
        await repository.fail(job, workerId, error);
        return { completed: false, error };
    } finally {
        clearInterval(timer);
    }
};

const claimAndProcess = async () => {
    const job = await repository.claim(workerId, leaseSeconds);
    if (!job) {
        return false;
    }
    await processJob(job);
    return true;
};

module.exports = { claimAndProcess, processJob, workerId, missingCodes };
