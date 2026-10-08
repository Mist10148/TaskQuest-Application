'use strict';

/**
 * Tables for the AI service (see docs/AI_INTEGRATION.md): embeddings for RAG,
 * chat threads and LangGraph checkpoints, per-user usage and a summary cache.
 * The Python service never runs DDL; everything it needs is created here.
 */

exports.description = 'AI embeddings, chat threads, checkpoints, usage and summary cache';

const TABLES = [
    // Vector store (one row per chunk). discord_id NULL = global help docs.
    `CREATE TABLE IF NOT EXISTS ai_embeddings (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(32) NULL,
        source_type ENUM('list','item','history','doc') NOT NULL,
        source_id VARCHAR(64) NOT NULL,
        list_id INT NULL,
        content TEXT NOT NULL,
        content_hash CHAR(64) NOT NULL,
        embedding BLOB NOT NULL,
        model VARCHAR(100) NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_ai_emb_source (source_type, source_id, model),
        INDEX idx_ai_emb_user (discord_id, source_type),
        INDEX idx_ai_emb_list (list_id),
        CONSTRAINT fk_ai_emb_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS ai_chat_threads (
        id CHAR(36) PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL,
        title VARCHAR(120) NOT NULL DEFAULT 'New chat',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ai_threads_user (discord_id, updated_at),
        CONSTRAINT fk_ai_threads_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS ai_checkpoints (
        thread_id CHAR(36) NOT NULL,
        checkpoint_ns VARCHAR(255) NOT NULL DEFAULT '',
        checkpoint_id VARCHAR(64) NOT NULL,
        parent_id VARCHAR(64) NULL,
        type VARCHAR(32) NULL,
        checkpoint LONGBLOB NOT NULL,
        metadata LONGBLOB NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id),
        CONSTRAINT fk_ai_ckpt_thread FOREIGN KEY (thread_id) REFERENCES ai_chat_threads (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS ai_checkpoint_writes (
        thread_id CHAR(36) NOT NULL,
        checkpoint_ns VARCHAR(255) NOT NULL DEFAULT '',
        checkpoint_id VARCHAR(64) NOT NULL,
        task_id VARCHAR(64) NOT NULL,
        idx INT NOT NULL,
        channel VARCHAR(100) NOT NULL,
        type VARCHAR(32) NULL,
        value LONGBLOB NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx),
        CONSTRAINT fk_ai_ckptw_thread FOREIGN KEY (thread_id) REFERENCES ai_chat_threads (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS ai_usage (
        discord_id VARCHAR(32) NOT NULL,
        day DATE NOT NULL,
        feature ENUM('summary','prioritize','chat','embed') NOT NULL,
        requests INT NOT NULL DEFAULT 0,
        input_tokens BIGINT NOT NULL DEFAULT 0,
        output_tokens BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (discord_id, day, feature),
        CONSTRAINT fk_ai_usage_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS ai_summary_cache (
        discord_id VARCHAR(32) NOT NULL,
        scope_key VARCHAR(100) NOT NULL,
        input_hash CHAR(64) NOT NULL,
        summary_json JSON NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (discord_id, scope_key),
        CONSTRAINT fk_ai_sumcache_user FOREIGN KEY (discord_id) REFERENCES users (discord_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

exports.up = async (h) => {
    for (const sql of TABLES) await h.exec(sql);
    // Users can opt out of AI features.
    await h.addColumnIfMissing('users', 'ai_enabled', 'TINYINT(1) NOT NULL DEFAULT 1');
};
