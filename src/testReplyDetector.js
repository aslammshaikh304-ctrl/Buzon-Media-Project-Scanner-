require("dotenv").config({
  path: [".env.local", ".env"],
});

const {
  runReplyDetector,
} = require("./replyDetector");

async function test() {
  console.log(
    "Testing reply detector..."
  );

  try {
    const result =
      await runReplyDetector();

    console.log(
      "\nReply detector result:"
    );

    console.dir(result, {
      depth: null,
    });
  } catch (error) {
    console.error(
      "Reply detector test failed:",
      error
    );
  }
}

test(); 