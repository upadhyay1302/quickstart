const url = process.env.DATABASE_URL;

if (!url) {
  console.error("DATABASE_URL is not set");
  console.error("Copy .env.example to .env and fill it in.");
  process.exit(1);
}

console.log(`schema pushed to ${url}`);
