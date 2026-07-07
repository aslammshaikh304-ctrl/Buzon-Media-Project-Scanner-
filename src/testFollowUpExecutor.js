require("dotenv").config({
  path: [".env.local", ".env"],
});

const {
  runFollowUpExecutor,
} = require("./followUpExecutor");

async function test() {
  console.log(
    "Testing follow-up executor..."
  );

  const result =
    await runFollowUpExecutor();

  console.log(
    "\nFollow-up executor result:"
  );

  console.dir(result, {
    depth: null,
  });
}

test()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);

    process.exit(1);
  });