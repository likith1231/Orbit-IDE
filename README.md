# AI Cloud IDE

A modern, cloud-based IDE built with React, Vite, Express, and Prisma. Features include multi-language container execution, AI assistance, and chaos engineering testing.

## Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

You will need the following installed on your machine:
- **Node.js**: v18 or newer
- **PostgreSQL**: Running locally or accessible via URL
- **Docker**: Must be installed and running. The backend requires access to the Docker socket (`/var/run/docker.sock`) to spawn execution containers.

### Installation

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd ai-cloud-ide
   ```

2. **Install Backend Dependencies:**
   ```bash
   cd backend
   npm install
   ```

3. **Install Frontend Dependencies:**
   ```bash
   cd ../frontend
   npm install
   ```

### Configuration

1. **Setup Environment Variables:**
   Navigate to the `backend` directory and copy the example environment file:
   ```bash
   cd backend
   cp .env.example .env
   ```
   Open the new `.env` file and fill in the required values (e.g., your PostgreSQL database URL, JWT secret, and Gemini API key).

2. **Run Prisma Migrations:**
   With your `DATABASE_URL` configured, initialize the database schema:
   ```bash
   npx prisma migrate dev --name init
   ```

### Docker Images

The sandbox execution engine relies on several Docker images. While they will download automatically on first use, you can pull them ahead of time to avoid execution delays.

```bash
docker pull node:20-alpine
docker pull python:3.12-alpine
docker pull eclipse-temurin:21-jdk-alpine
docker pull gcc:13-bookworm
docker pull mcr.microsoft.com/dotnet/sdk:8.0-alpine
docker pull golang:1.22-alpine
docker pull rust:1.78-slim
docker pull ruby:3.3-alpine
docker pull php:8.3-cli-alpine
docker pull bash:5.2-alpine
docker pull perl:5.38-slim
docker pull akorn/lua:5.4-alpine
docker pull r-base:4.3.3
```

### Running the Application

1. **Start the Backend:**
   In the `backend` directory, start the Express server:
   ```bash
   npm start
   ```

2. **Start the Frontend:**
   In a new terminal window, navigate to the `frontend` directory and start the Vite dev server:
   ```bash
   cd frontend
   npm run dev
   ```
   The IDE should now be accessible at `http://localhost:5173`.

## Testing

The project has comprehensive testing at both the API level and End-to-End.

### Unit & Integration Tests (Backend)
Backend tests are built with Jest and Supertest, running against a dedicated test database to ensure isolation.

1. Configure your `.env` in the `backend` directory, making sure `TEST_DATABASE_URL` is set to a separate test database.
2. Ensure the test database exists in PostgreSQL.
3. Run the tests:
   ```bash
   cd backend
   npm test
   ```

### End-to-End Tests (Frontend)
End-to-End tests are built with Playwright, testing the full critical path including signup, code execution, AI assistance, and file persistence.

1. Ensure your backend is running (`cd backend && npm start`).
2. Ensure your frontend is running (`cd frontend && npm run dev`).
3. Run the Playwright test suite:
   ```bash
   cd frontend
   npm run test:e2e
   ```
   To run in UI mode for debugging:
   ```bash
   cd frontend
   npx playwright test --ui
   ```

## Rate Limits

To protect against abuse and brute-force attacks, the backend API enforces several rate limits per IP address:

- **Authentication (`/api/auth/login`, `/api/auth/signup`)**: 5 requests per 15 minutes.
- **Docker Execution (`/api/run`, `/api/chaos`, `/api/containers`)**: 10 requests per minute.
- **General API**: 100 requests per 15 minutes.

If a limit is exceeded, the server will return a 429 status code with a JSON error message and a `Retry-After` header. This is expected behavior during heavy usage.

## Known Limitations

- **Docker Socket Requirement**: The backend heavily relies on mounting `/var/run/docker.sock` to orchestrate sandbox containers. This application cannot be deployed as-is to serverless environments (like Vercel or AWS Lambda) or locked-down PaaS platforms without modifying the execution strategy.
- **Network Access in Sandbox**: Some language runtimes (e.g., C# with `dotnet run` or TypeScript with `npx tsx`) currently require network access inside the Docker sandbox to fetch packages or run execution frameworks.
- **Cold Start Delays**: The very first code execution for a specific language will be significantly slower as the server pulls the necessary Docker image from Docker Hub. Pulling the images ahead of time mitigates this.
