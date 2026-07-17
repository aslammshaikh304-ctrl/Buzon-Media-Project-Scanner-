const { supabase } = require("./supabase");
const { sendEmail } = require("./emailSender");

async function getForwardingEmails() {
  const { data, error } = await supabase
    .from("reply_forwarding")
    .select("*")
    .eq("is_active", true);

  if (error) {
    throw error;
  }

  return data || [];
}

async function forwardReply({
  reply,
  parsed,
  advertiser,
  campaign,
}) {
  const recipients =
    await getForwardingEmails();

  if (!recipients.length) {
    return;
  }

  const subject =
    `REPLY: ${advertiser.company_name}`;

  const html = `
<h2>New Campaign Reply</h2>

<p><strong>Company:</strong>
${advertiser.company_name}</p>

<p><strong>Campaign:</strong>
${campaign.name}</p>

<p><strong>From:</strong>
${parsed.from?.text || ""}</p>

<p><strong>Subject:</strong>
${parsed.subject || ""}</p>

<hr>

<pre>${parsed.text || ""}</pre>
`;

  for (const recipient of recipients) {
    await sendEmail({
      to: recipient.email,
      subject,
      html,
      text: parsed.text || "",
    });
  }

  console.log(
    `Reply forwarded to ${recipients.length} recipients`
  );
}

module.exports = {
  forwardReply,
};