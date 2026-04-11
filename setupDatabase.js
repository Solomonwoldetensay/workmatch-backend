// ─────────────────────────────────────────────
// WorkMatch — Database Setup Script
// Run once with: node config/setupDatabase.js
// Creates all tables in the correct order
// ─────────────────────────────────────────────

require('dotenv').config();
const { pool } = require('./database');

const createTables = async () => {
  console.log('🚀  Setting up WorkMatch database...\n');

  try {

    // ── USERS TABLE ──────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email         VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name     VARCHAR(255) NOT NULL,
        bio           TEXT,
        location      VARCHAR(255),
        skills        TEXT[],
        avatar_url    VARCHAR(500),
        role          VARCHAR(50) DEFAULT 'user',
        is_verified   BOOLEAN DEFAULT false,
        investor_profile JSONB,
        created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('  ✅  users table created');

    // ── PROJECTS TABLE ────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title           VARCHAR(255) NOT NULL,
        description     TEXT NOT NULL,
        category        VARCHAR(100) NOT NULL,
        tags            TEXT[],
        required_skills TEXT[],
        mode            VARCHAR(20) NOT NULL CHECK (mode IN ('collab', 'invest', 'both')),
        stage           VARCHAR(50),
        investment_target DECIMAL(12,2),
        equity_offered  DECIMAL(5,2),
        video_url       VARCHAR(500),
        image_url       VARCHAR(500),
        is_active       BOOLEAN DEFAULT true,
        views           INTEGER DEFAULT 0,
        created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('  ✅  projects table created');

    // ── SWIPES TABLE — records every swipe/button action ─────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS swipes (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        swiper_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        action       VARCHAR(20) NOT NULL CHECK (action IN ('skip', 'collab', 'invest', 'super')),
        created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(swiper_id, project_id, action)
      );
    `);
    console.log('  ✅  swipes table created');

    // ── MATCHES TABLE — created when creator accepts ──────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        creator_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        discoverer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        match_type     VARCHAR(20) NOT NULL CHECK (match_type IN ('collab', 'invest')),
        status         VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
        investment_amount DECIMAL(12,2),
        message        TEXT,
        created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(project_id, discoverer_id, match_type)
      );
    `);
    console.log('  ✅  matches table created');

    // ── CONVERSATIONS TABLE ───────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        match_id     UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        user1_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user2_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_message TEXT,
        last_message_at TIMESTAMP WITH TIME ZONE,
        created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('  ✅  conversations table created');

    // ── MESSAGES TABLE ────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content         TEXT NOT NULL,
        is_read         BOOLEAN DEFAULT false,
        created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('  ✅  messages table created');

    // ── INDEXES for fast queries ───────────────────────────────────
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_creator   ON projects(creator_id);
      CREATE INDEX IF NOT EXISTS idx_projects_category  ON projects(category);
      CREATE INDEX IF NOT EXISTS idx_projects_mode      ON projects(mode);
      CREATE INDEX IF NOT EXISTS idx_projects_active    ON projects(is_active);
      CREATE INDEX IF NOT EXISTS idx_swipes_swiper      ON swipes(swiper_id);
      CREATE INDEX IF NOT EXISTS idx_swipes_project     ON swipes(project_id);
      CREATE INDEX IF NOT EXISTS idx_matches_creator    ON matches(creator_id);
      CREATE INDEX IF NOT EXISTS idx_matches_discoverer ON matches(discoverer_id);
      CREATE INDEX IF NOT EXISTS idx_messages_convo     ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_sender    ON messages(sender_id);
    `);
    console.log('  ✅  indexes created');

    // ── UPDATE TRIGGER — auto-update updated_at ───────────────────
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ language 'plpgsql';

      DO $$ BEGIN
        CREATE TRIGGER update_users_updated_at    BEFORE UPDATE ON users    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        CREATE TRIGGER update_matches_updated_at  BEFORE UPDATE ON matches  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
      EXCEPTION WHEN duplicate_object THEN NULL; END; $$;
    `);
    console.log('  ✅  triggers created');

    console.log('\n🎉  Database setup complete! All tables and indexes created.\n');
    console.log('Next step: run  npm run dev  to start the server.\n');

  } catch (error) {
    console.error('\n❌  Database setup failed:', error.message);
    console.error('    Make sure PostgreSQL is running and your .env file is correct.\n');
  } finally {
    pool.end();
  }
};

createTables();
