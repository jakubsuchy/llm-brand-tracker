# LLM Brand Tracker

A brand monitoring and competitive intelligence platform that analyzes how you and your competitor brands are mentioned and discussed across various topics in LLM responses. In its current iteration, this project only looks at ChatGPT (future platforms will be added).

## 🎯 Overview

A web application focused on brand positioning and mentions in LLMs, starting with ChatGPT today. Specific components:
- prompt research & analysis
- brand mentions, both your own and competitors
- sources cited in prompts

It automatically scrapes brand websites, generates targeted prompts, and processes responses to provide actionable areas of improvement, like where your brand should be mentioned. The flow:
- analyze your own provided website
- figure out competitors, with user input
- use ChatGPT to generate diverse prompts
- use ChatGPT to fetch prompt results
- display prompt results and sources cited

## ✨ Key Features

- **Website Analysis**: Automatically scrapes and analyzes your brand website
- **Competitor Tracking**: Identifies and monitors competitor mentions in ChatGPT responses
- **Prompt Generation**: Creates diverse, relevant prompts for comprehensive brand analysis
- **Source Attribution**: Tracks which sources and domains are cited in responses
- **Progress Over Time**: Monitor analysis progress over time
- **Actionable Next Steps**: Identifies where your brand should be mentioned but isn't

## 🏗️ Architecture

### Backend Stack
- **Node.js/Express**: RESTful API server
- **PostgreSQL**: Primary database with Drizzle ORM
- **OpenAI API**: LLM integration for analysis
- **WebSocket**: Real-time progress updates

### Frontend Stack
- **React 18**: Modern UI framework
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **Radix UI**: Accessible component primitives
- **Vite**: Fast development and build tooling

### Database Schema
- **Topics**: Analysis categories and themes
- **Prompts**: Generated analysis questions
- **Responses**: AI-generated brand analysis
- **Competitors**: Competitor tracking and mentions
- **Sources**: Citation and domain tracking
- **Analytics**: Aggregated metrics and insights

## 🚀 Quick Start

### Option 1: Docker (recommended)

The easiest way to run the app. Includes PostgreSQL — no local database setup needed.

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/llm-brand-tracker.git
   cd llm-brand-tracker
   ```

2. **Create a `.env` file**
   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   ```

3. **Start the app**
   ```bash
   docker compose up --build
   ```
   This builds the app, starts PostgreSQL, runs the schema migration, and serves the app on `http://localhost:3000`.

4. **Stop / reset**
   ```bash
   docker compose down        # Stop containers (data preserved in pgdata volume)
   docker compose down -v     # Stop and wipe database
   ```

### Option 2: Local development

For development without Docker. Requires Node.js 18+ and a local PostgreSQL instance.

1. **Clone and install**
   ```bash
   git clone https://github.com/yourusername/llm-brand-tracker.git
   cd llm-brand-tracker
   npm install
   ```

2. **Set up PostgreSQL**
   ```bash
   brew install postgresql   # macOS
   brew services start postgresql

   createdb brand_tracker
   psql -d brand_tracker -c "CREATE USER admin WITH PASSWORD 'your_password';"
   psql -d brand_tracker -c "GRANT ALL PRIVILEGES ON DATABASE brand_tracker TO admin;"
   psql -d brand_tracker -c "GRANT ALL ON SCHEMA public TO admin;"
   ```

3. **Create a `.env` file**
   ```env
   DATABASE_URL=postgresql://admin:your_password@localhost:5432/brand_tracker
   OPENAI_API_KEY=your_openai_api_key_here
   ```

4. **Push schema and start**
   ```bash
   npm run db:push
   npm run dev
   ```

5. **Open** `http://localhost:3000`

### Available Scripts
```bash
npm run dev          # Start dev server (port 3000)
npm run build        # Vite build + esbuild server bundle
npm run start        # Production server (node dist/index.js)
npm run db:push      # Push schema to DB (drizzle-kit push)
docker compose up --build   # Build and run with PostgreSQL
docker compose down -v      # Stop and wipe DB
```

## 📖 Usage

### 1. Brand Analysis Setup
- Navigate to the dashboard
- Enter your brand URL (e.g., `https://yourbrand.com`)
- Configure analysis settings (number of topics, prompts per topic)

### 2. Run Analysis
- Click "Start Analysis" to begin the automated process
- Monitor real-time progress through the web interface
- View live updates as prompts are generated and processed

### 3. Review Results
- **Overview Metrics**: High-level brand mention statistics
- **Topic Analysis**: Brand perception across different categories
- **Competitor Analysis**: Competitive landscape insights
- **Source Analysis**: Citation and domain tracking

## 🛠️ Development & Future

Recent improvements:
- ~~Local Postgres only~~ — Dockerized with persistent volumes
- ~~No deployment options~~ — Docker Compose with one-command startup
- ~~Prompts are redundant~~ — Brand-neutral prompt generation with deduplication
- ~~Prompt specificity~~ — Dynamic topic generation based on brand analysis
- ~~Competitor completeness~~ — Improved detection with merge feature for duplicates
- ~~Speed~~ — 3 concurrent workers with rate limit backoff

Remaining areas for improvement:
1. **Auth**. No user authentication — anyone with access can run analysis
2. **Multi-LLM support**. Currently ChatGPT only — Claude, Gemini, Perplexity planned
3. **Scheduled runs**. Analysis only runs manually — needs background scheduling
4. **Export/reporting**. Limited export options — needs PDF reports, email digests

This project is public. Contributions welcome.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 🆘 Support

**Issues**: Report bugs and feature requests on GitHub. Better yet, contribute and fix them.
