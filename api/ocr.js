// api/ocr.js

export default async function handler(req, res) {
  /*
    Technical Gemini/API errors are NEVER exposed to the user.
    Full technical details are logged in Vercel.
  */

  // =========================================================
  // METHOD
  // =========================================================

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "PROCESSING_FAILED"
    });
  }

  try {
    // =========================================================
    // REQUEST DATA
    // =========================================================

    const {
      images,
      names = [],
      defaultRate = 0
    } = req.body || {};

    // =========================================================
    // API KEY
    // =========================================================

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error(
        "GEMINI_API_KEY is missing."
      );

      return res.status(500).json({
        error: "PROCESSING_FAILED"
      });
    }

    // =========================================================
    // IMAGES VALIDATION
    // =========================================================

    if (
      !Array.isArray(images) ||
      images.length === 0
    ) {
      console.error(
        "No images received."
      );

      return res.status(400).json({
        error: "PROCESSING_FAILED"
      });
    }

    if (images.length > 12) {
      console.error(
        `Too many images: ${images.length}`
      );

      return res.status(400).json({
        error: "PROCESSING_FAILED"
      });
    }

    // =========================================================
    // MODEL
    // =========================================================

    const model = "gemini-3.6-flash";

    // =========================================================
    // NAME MASTER
    // =========================================================

    const master = Array.isArray(names)
      ? names
          .filter(
            name =>
              typeof name === "string" &&
              name.trim()
          )
          .map(name => name.trim())
          .slice(0, 500)
      : [];

    // =========================================================
    // PROMPT
    // =========================================================

    const prompt = `
You are a highly accurate OCR and data extraction assistant
for handwritten Pakistani cotton purchase records.

Read ALL supplied notebook images carefully.

The handwriting may contain:

- Urdu
- Roman Urdu
- Arabic/Urdu digits
- English digits
- Mixed Urdu and numbers

Your job is to extract every clearly visible cotton purchase
record from ALL supplied images.

Return ONLY valid JSON:

{
  "records": [
    {
      "name": "...",
      "weight": 0
    }
  ]
}

IMPORTANT RULES:

1. Extract every clearly visible record row.

2. Do not invent records.

3. Do not create records from the Name Master alone.

4. If a record is unclear, do not guess.

5. Weight must be numeric kilograms.

6. Convert Urdu and Arabic digits into normal English numbers.

Examples:

۱۲.۵ = 12.5
۲۵ = 25
۳۶ = 36

7. Convert Arabic decimal separator "٫" to ".".

8. Separate person's name from weight.

9. Ignore leading record codes such as:
   0-36
   1-25
   2-40

   unless the code is clearly part of the person's name.

10. Use the Name Master only to improve spelling
    and match a name that is actually visible in the image.

11. Do not return a Name Master person unless
    that person's record is actually visible.

12. Do not merge separate rows during OCR.

13. Keep every visible row as a separate record.

14. Weight must be zero or greater.

15. Do not include money or rate in the JSON.

16. Do not include explanations.

17. Do not include markdown.

18. Return JSON only.

NAME MASTER:
${JSON.stringify(master)}

DEFAULT RATE:
${Number(defaultRate) || 0}
`;

    // =========================================================
    // IMAGE PARTS
    // =========================================================

    const parts = [
      {
        text: prompt
      }
    ];

    let validImageCount = 0;

    // =========================================================
    // PROCESS IMAGES
    // =========================================================

    for (const image of images) {
      if (
        !image ||
        typeof image.data !== "string" ||
        !image.data.trim()
      ) {
        console.error(
          "Invalid image object."
        );

        continue;
      }

      let imageData =
        image.data.trim();

      let mimeType =
        String(
          image.mimeType ||
          "image/jpeg"
        );

      /*
        IMPORTANT:

        If frontend sends:

        data:image/jpeg;base64,AAAA....

        remove the data URL prefix.

        Gemini needs only:

        AAAA....
      */

      if (
        imageData.startsWith(
          "data:"
        )
      ) {
        const match =
          imageData.match(
            /^data:(image\/[^;]+);base64,(.+)$/s
          );

        if (!match) {
          console.error(
            "Invalid data URL image."
          );

          continue;
        }

        mimeType =
          match[1];

        imageData =
          match[2];
      }

      // -------------------------------------------------------
      // MIME TYPE VALIDATION
      // -------------------------------------------------------

      if (
        !mimeType.startsWith(
          "image/"
        )
      ) {
        mimeType =
          "image/jpeg";
      }

      // -------------------------------------------------------
      // BASE64 VALIDATION
      // -------------------------------------------------------

      if (!imageData) {
        console.error(
          "Empty image data."
        );

        continue;
      }

      // -------------------------------------------------------
      // GEMINI IMAGE PART
      // -------------------------------------------------------

      parts.push({
        inline_data: {
          mime_type: mimeType,
          data: imageData
        }
      });

      validImageCount++;
    }

    // =========================================================
    // VALID IMAGE CHECK
    // =========================================================

    if (validImageCount === 0) {
      console.error(
        "No valid images remained after validation."
      );

      return res.status(400).json({
        error: "PROCESSING_FAILED"
      });
    }

    // =========================================================
    // GEMINI ENDPOINT
    // =========================================================

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // =========================================================
    // GEMINI REQUEST
    // =========================================================

    const response =
      await fetch(
        endpoint,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-goog-api-key":
              apiKey
          },

          body:
            JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts
                }
              ],

              generationConfig: {
                /*
                  DO NOT use temperature here.
                  Gemini 3.6 Flash has deprecated
                  temperature/top_p/top_k.
                */

                responseMimeType:
                  "application/json"
              }
            })
        }
      );

    // =========================================================
    // READ GEMINI RESPONSE
    // =========================================================

    const raw =
      await response.text();

    let data = {};

    try {
      data =
        JSON.parse(raw);
    } catch {
      console.error(
        "Gemini returned non-JSON HTTP response:",
        raw
      );

      data = {};
    }

    // =========================================================
    // GEMINI ERROR
    // =========================================================

    if (!response.ok) {
      console.error(
        "Gemini API error:",
        response.status,
        data?.error?.message ||
          raw
      );

      return res.status(500).json({
        error: "PROCESSING_FAILED"
      });
    }

    // =========================================================
    // EXTRACT GEMINI TEXT
    // =========================================================

    const text =
      data
        ?.candidates?.[0]
        ?.content?.parts
        ?.map(
          part =>
            part?.text || ""
        )
        .join("")
        .trim() || "";

    if (!text) {
      console.error(
        "Gemini returned empty OCR response.",
        JSON.stringify(data)
      );

      return res.status(500).json({
        error: "PROCESSING_FAILED"
      });
    }

    // =========================================================
    // PARSE JSON
    // =========================================================

    let parsed = null;

    try {
      parsed =
        JSON.parse(text);

    } catch {
      /*
        Fallback in case Gemini adds
        unexpected characters around JSON.
      */

      const match =
        text.match(
          /\{[\s\S]*\}/
        );

      if (!match) {
        console.error(
          "Gemini returned invalid JSON:",
          text
        );

        return res.status(500).json({
          error: "PROCESSING_FAILED"
        });
      }

      try {
        parsed =
          JSON.parse(
            match[0]
          );

      } catch (error) {
        console.error(
          "Recovered JSON could not be parsed:",
          error
        );

        return res.status(500).json({
          error: "PROCESSING_FAILED"
        });
      }
    }

    // =========================================================
    // CLEAN NAME
    // =========================================================

    function cleanName(value) {
      if (
        value === null ||
        value === undefined
      ) {
        return "";
      }

      return String(value)
        .replace(/\s+/g, " ")
        .trim();
    }

    // =========================================================
    // NORMALIZE DIGITS
    // =========================================================

    function normalizeDigits(value) {
      if (
        value === null ||
        value === undefined
      ) {
        return "";
      }

      return String(value)

        // Urdu digits
        .replace(
          /[۰-۹]/g,
          d =>
            String(
              "۰۱۲۳۴۵۶۷۸۹"
                .indexOf(d)
            )
        )

        // Arabic digits
        .replace(
          /[٠-٩]/g,
          d =>
            String(
              "٠١٢٣٤٥٦٧٨٩"
                .indexOf(d)
            )
        )

        // Arabic decimal point
        .replace(
          /٫/g,
          "."
        )

        // Arabic comma
        .replace(
          /،/g,
          ","
        );
    }

    // =========================================================
    // CLEAN WEIGHT
    // =========================================================

    function cleanWeight(value) {
      const normalized =
        normalizeDigits(value)
          .replace(/,/g, "")
          .trim();

      if (!normalized) {
        return NaN;
      }

      const number =
        Number(normalized);

      if (
        !Number.isFinite(number)
      ) {
        return NaN;
      }

      if (number < 0) {
        return NaN;
      }

      /*
        Prevent obviously abnormal OCR values.
      */

      if (number > 100000) {
        return NaN;
      }

      return number;
    }

    // =========================================================
    // RAW RECORDS
    // =========================================================

    const rawRecords =
      Array.isArray(
        parsed?.records
      )
        ? parsed.records
        : [];

    // =========================================================
    // CLEAN RECORDS
    // =========================================================

    const records = [];

    for (
      const item of rawRecords
    ) {
      if (
        !item ||
        typeof item !==
          "object"
      ) {
        continue;
      }

      const name =
        cleanName(
          item.name
        );

      const weight =
        cleanWeight(
          item.weight
        );

      if (!name) {
        continue;
      }

      if (
        !Number.isFinite(
          weight
        )
      ) {
        continue;
      }

      records.push({
        name,
        weight
      });
    }

    // =========================================================
    // SUCCESS
    // =========================================================

    console.log(
      `OCR successful: ${validImageCount} image(s), ${records.length} record(s)`
    );

    return res.status(200).json({
      records
    });

  } catch (error) {
    // =========================================================
    // SERVER ERROR
    // =========================================================

    console.error(
      "OCR SERVER ERROR:",
      error
    );

    return res.status(500).json({
      error: "PROCESSING_FAILED"
    });
  }
}
