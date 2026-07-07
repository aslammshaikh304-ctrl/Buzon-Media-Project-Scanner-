const { supabase } = require("./supabase");

async function getAvailableSmtpAccounts() {
  const { data, error } = await supabase
    .from("smtp_accounts")
    .select("*")
    .eq("is_active", true)
    .order("last_used_at", {
      ascending: true,
      nullsFirst: true,
    });

  if (error) {
    throw error;
  }

  return (data || []).filter((account) => {
    const dailyLimit = account.daily_limit || 0;
    const sentToday = account.sent_today || 0;

    return sentToday < dailyLimit;
  });
}

async function selectSmtpAccount() {
  const accounts = await getAvailableSmtpAccounts();

  if (!accounts.length) {
    return null;
  }

  return accounts[0];
}

async function markSmtpAccountUsed(accountId) {
  const { data: account, error: fetchError } =
    await supabase
      .from("smtp_accounts")
      .select("sent_today")
      .eq("id", accountId)
      .single();

  if (fetchError) {
    throw fetchError;
  }

  const nextSentToday =
    (account.sent_today || 0) + 1;

  const { error } = await supabase
    .from("smtp_accounts")
    .update({
      sent_today: nextSentToday,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", accountId);

  if (error) {
    throw error;
  }

  return nextSentToday;
}

async function markSmtpHealth(
  accountId,
  healthStatus
) {
  const { error } = await supabase
    .from("smtp_accounts")
    .update({
      health_status: healthStatus,
      last_health_check_at:
        new Date().toISOString(),
    })
    .eq("id", accountId);

  if (error) {
    throw error;
  }
}

module.exports = {
  getAvailableSmtpAccounts,
  selectSmtpAccount,
  markSmtpAccountUsed,
  markSmtpHealth,
};