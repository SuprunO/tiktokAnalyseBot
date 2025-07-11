const { chromium } = require("playwright");
const OpenAI = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

(async () => {
  const keyword = process.argv[2] || "fitness";

  console.log(`🔎 Виконується пошук за ключовим словом: "${keyword}"`);

  const browser = await chromium.launch({
    headless: true,
    slowMo: 100,
    devtools: true,
  });

  const page = await browser.newPage();

  await page.goto(
    "https://ads.tiktok.com/business/creativecenter/keyword-insights/pc/en?rid=be0o73724t6",
    { waitUntil: "networkidle" }
  );

  console.log("⏳ Очікую завантаження сторінки...");
  await page.waitForTimeout(10000);

  console.log("✅ Знаходжу поле пошуку...");
  await page.waitForSelector('input[placeholder="Search by keyword"]', {
    timeout: 10000,
  });
  await page.fill('input[placeholder="Search by keyword"]', keyword);

  console.log("🔎 Надсилаю запит...");
  await page.click('[data-testid="cc_commonCom_autoComplete_seach"]');

  console.log("⏳ Очікую результатів...");
  await page.waitForSelector(".byted-Table-Body", { timeout: 20000 });

  const data = await page.evaluate(() => {
    const tableBody = document.querySelector(".byted-Table-Body");
    if (!tableBody) return [];

    const rows = Array.from(tableBody.querySelectorAll("tr"));
    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll("td")).map((td) =>
        td.innerText.trim()
      );
      return {
        rank: cells[0] || "",
        keyword: cells[1] || "",
        popularity: cells[2] || "",
        popularityChange: cells[3] || "",
        ctr: cells[4] || "",
        cvr: cells[5] || "",
        cpa: cells[6] || "",
      };
    });
  });

  // Обчислення Content Gap Score
  data.forEach((item) => {
    const ctrVal =
      parseFloat(item.ctr.replace("%", "").replace(",", ".")) || 0.01;
    const cpaVal =
      parseFloat(item.cpa.replace(/[^\d.,]/g, "").replace(",", ".")) || 0.01;
    const popChangeVal =
      parseFloat(item.popularityChange.replace("%", "").replace(",", ".")) || 0;
    const score = popChangeVal * (cpaVal / ctrVal);
    item.contentGapScore = Number(score.toFixed(2));
  });

  // Сортування за Content Gap Score
  data.sort((a, b) => b.contentGapScore - a.contentGapScore);

  // Вивід таблиці
  console.log(
    `\n✅ Результати для ключового слова "${keyword}" (відсортовані за Content Gap Score):`
  );
  if (data.length > 0) {
    console.table(
      data.map((item, idx) => ({
        "№": idx + 1,
        Ранг: item.rank,
        "Ключове слово": item.keyword,
        Популярність: item.popularity,
        "Зміна популярності": item.popularityChange,
        CTR: item.ctr,
        CVR: item.cvr,
        CPA: item.cpa,
        "Content Gap Score": item.contentGapScore,
      }))
    );
  } else {
    console.log("❗ Дані не знайдено у Creative Center.");
  }

  // ✅ логіка якщо зовсім немає результатів
  if (data.length === 0) {
    console.log("❗ У Creative Center не знайдено жодного результату.");
    console.log("💬 Звертаюсь до GPT для генерації штучної ідеї на цю тему...");

    const fallbackPrompt = `
Ти досвідчений маркетолог і сценарист для TikTok Ads.

У TikTok Creative Center немає жодних даних за запитом "${keyword}".

Згенеруй самостійно ідею для відео на цю тему:

1️⃣ 📌 Слово: "${keyword}" (тема відео)

2️⃣ 🎥 Сценарій для 1-хвилинного відео
   - Вау-ефект у перші 3 секунди
   - Основна ідея розвитку сюжету
   - Заклик до дії

3️⃣ 📊 Чому ця тема може спрацювати (сильні сторони і можливі ризики)

4️⃣ 🏷️ Пропозиція 5-7 хештегів, релевантних темі

Відповідай українською мовою.
`;

    const fallbackCompletion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "Ти досвідчений маркетолог і TikTok-креатор. Відповідай українською мовою.",
        },
        { role: "user", content: fallbackPrompt },
      ],
    });

    const fallbackAnswer = fallbackCompletion.choices[0].message.content;
    console.log("\n🧭 GPT згенерував ідею для теми без даних:");
    console.log(fallbackAnswer);

    await browser.close();
    process.exit(0);
  }

  // ✅ Якщо даних мало, але хоч щось є (1-4), все одно генеруємо аналіз по наявних
  const topN = data.slice(0, Math.min(5, data.length));

  // Формування промпту для GPT
  function makeTopPrompt(keyword, results) {
    const rowsText = results
      .map((item, idx) =>
        `
#${idx + 1}
Ключове слово: ${item.keyword}
Ранг: ${item.rank}
Популярність: ${item.popularity}
Зміна популярності: ${item.popularityChange}
CTR: ${item.ctr}
CVR: ${item.cvr}
CPA: ${item.cpa}
Content Gap Score: ${item.contentGapScore}
`.trim()
      )
      .join("\n\n");

    return `
Ти досвідчений маркетинговий аналітик і сценарист для TikTok Ads. Відповідай українською мовою.

Клієнт хоче аналітику для слова "${keyword}". Знайдено ${results.length} результат(и).

Для кожного результату зроби дуже детальний і зрозумілий розбір. Формат для кожного ключа:

1️⃣ 📌 Слово: [ключове слово]

2️⃣ 📊 Аналіз показників
   - Популярність: поясни чи це високий чи низький показник для ніші
   - Зміна популярності: поясни що означає цей відсоток і як його інтерпретувати
   - CTR: що каже цей показник про цікавість реклами
   - CVR: що показує цей відсоток і чому це важливо
   - CPA: поясни значення вартості за дію і чи це дешево чи дорого
   - Content Gap Score: поясни що це за метрика, що означає високий або низький бал
   - Сильні сторони: деталізовано – розпиши сильні показники, чому це вигідно рекламодавцю
   - Слабкі сторони: деталізовано – де є ризики або що може не спрацювати

3️⃣ 🎥 Сценарій для 1-хвилинного відео
   - Вау-ефект у перші 3 секунди
   - Основна ідея розвитку сюжету
   - Заклик до дії

4️⃣ 🏷️ Пропозиція 5-7 хештегів
   - добери релевантні, українською мовою
   - поясни як вони можуть допомогти просуванню

Важливо: відповідай простою українською мовою без зайвого канцеляриту.

Ось знайдені результати:
${rowsText}
`;
  }

  const prompt = makeTopPrompt(keyword, topN);

  console.log("\n💬 Запит до GPT на аналітику українською мовою...");

  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content:
          "Ти досвідчений маркетинговий аналітик. Відповідай українською мовою.",
      },
      { role: "user", content: prompt },
    ],
  });

  const gptAnswer = completion.choices[0].message.content;
  console.log("\n🧭 GPT-аналітика українською:");
  console.log(gptAnswer);

  await browser.close();
})();
