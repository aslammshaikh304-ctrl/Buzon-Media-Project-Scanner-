const { supabase } = require("./supabase");

async function saveDiscoveredContact(contact) {
  if (!contact?.advertiserId) {
    throw new Error("advertiserId missing");
  }

  const hasContact =
    contact.email ||
    contact.linkedin ||
    contact.telegram ||
    contact.twitter ||
    contact.contactFormUrl;

  if (!hasContact) {
    console.log(
      `No contact data found: ${contact.companyName}`
    );

    return {
      saved: false,
      reason: "no_contact_data",
    };
  }

  console.log(
    `Saving contact: ${contact.companyName}`
  );

  const { data: existingContact, error: lookupError } =
    await supabase
      .from("contacts")
      .select("id")
      .eq("advertiser_id", contact.advertiserId)
      .maybeSingle();

  if (lookupError) {
    throw new Error(
      `Contact lookup failed: ${lookupError.message}`
    );
  }

  const payload = {
    advertiser_id: contact.advertiserId,
    email: contact.email || null,
    phone: null,
    telegram: contact.telegram || null,
    twitter: contact.twitter || null,
    linkedin: contact.linkedin || null,
    contact_form_url:
      contact.contactFormUrl || null,
    source_url: contact.sourceUrl || null,
    is_primary: true,
    updated_at: new Date().toISOString(),
  };

  if (existingContact) {
    const { data, error } = await supabase
      .from("contacts")
      .update(payload)
      .eq("id", existingContact.id)
      .select()
      .single();

    if (error) {
      throw new Error(
        `Contact update failed: ${error.message}`
      );
    }

    console.log(
      `Contact updated: ${contact.companyName}`
    );

    return {
      saved: true,
      action: "updated",
      contact: data,
    };
  }

  const { data, error } = await supabase
    .from("contacts")
    .insert({
      ...payload,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(
      `Contact insert failed: ${error.message}`
    );
  }

  console.log(
    `Contact created: ${contact.companyName}`
  );

  return {
    saved: true,
    action: "created",
    contact: data,
  };
}

async function saveDiscoveredContacts(contacts) {
  const results = [];

  for (const contact of contacts) {
    try {
      const result =
        await saveDiscoveredContact(contact);

      results.push({
        advertiserId: contact.advertiserId,
        companyName: contact.companyName,
        success: true,
        ...result,
      });
    } catch (error) {
      console.error(
        `Failed saving contact ${contact.companyName}:`,
        error.message
      );

      results.push({
        advertiserId: contact.advertiserId,
        companyName: contact.companyName,
        success: false,
        error: error.message,
      });
    }
  }

  return results;
}

module.exports = {
  saveDiscoveredContact,
  saveDiscoveredContacts,
};