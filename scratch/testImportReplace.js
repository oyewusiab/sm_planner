const url = "https://script.google.com/macros/s/AKfycby9YC2DAtKdAv20l5GB79pu6_O81ExqrExpDEWmNpMeX4nQzIPIN5oSumIcY9IVig_vBg/exec";

async function testImportReplace() {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "import",
        mode: "replace",
        db: {
          MEMBERS: [{ name: "Test Member", gender: "M" }]
        }
      })
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text.slice(0, 500));
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

testImportReplace();
