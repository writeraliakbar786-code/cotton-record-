// api/ocr.js

export default async function handler(req, res) {

  /*
    User ko kabhi Gemini/API technical error nahi milega.
    Technical details sirf Vercel logs mein jayengi.
  */

  if (req.method !== "POST") {

    return res.status(405).json({
      error: "PROCESSING_FAILED"
    });

  }


  try {

    const {
      images,
      names = [],
      defaultRate = 0
    } = req.body || {};


    /* =========================
       API KEY
    ========================= */

    const apiKey =
      process.env.GEMINI_API_KEY;


    if (!apiKey) {

      console.error(
        "GEMINI_API_KEY is missing."
      );

      return res.status(500).json({
        error: "PROCESSING_FAILED"
      });

    }


    /* =========================
       IMAGES
    ========================= */

    if (
      !Array.isArray(images) ||
      images.length === 0
    ) {

      return res.status(400).json({
        error: "PROCESSING_FAILED"
      });

    }


    if (images.length > 12) {

      return res.status(400).json({
        error: "PROCESSING_FAILED"
      });

    }


    /* =========================
       MODEL
    ========================= */

    const model =
      "gemini-3.6-flash";


    /* =========================
       NAME MASTER
    ========================= */

    const master =
      Array.isArray(names)
        ? names
            .filter(
              name =>
                typeof name === "string" &&
                name.trim()
            )
            .map(
              name =>
                name.trim()
            )
            .slice(0,500)
        : [];


    /* =========================
       PROMPT
    ========================= */

    const prompt = `

You are a highly accurate OCR/data extraction assistant for handwritten Pakistani cotton purchase records.

Read ALL supplied notebook images carefully.

The handwriting may contain:

- Urdu
- Roman Urdu
- Arabic/Urdu digits
- English digits
- Mixed Urdu and numbers

Extract every visible cotton record.

Return ONLY valid JSON:

{"records":[{"name":"...","weight":0}]}

Rules:

1. Extract every visible record row.

2. Do not invent records.

3. Do not skip clearly readable records.

4. Weight must be numeric kilograms.

5. Convert Urdu/Arabic digits into normal numbers.

6. Examples:

۱۲.۵ = 12.5
۲۵ = 25
۳۶ = 36

7. Ignore leading codes such as 0-36 or 1-25 unless clearly part of the person's name.

8. Separate person's name from weight.

9. Use Name Master for spelling and matching.

10. Only use a Name Master name when the actual image contains a matching record.

11. Do not create records merely because a name exists in Name Master.

12. Do not return explanations.

13. Do not return markdown.

14. Return JSON only.

Name Master:
${JSON.stringify(master)}

Default rate:
${Number(defaultRate) || 0}

Do not include rate in JSON.

`;


    /* =========================
       IMAGE PARTS
    ========================= */

    const parts = [
      {
        text: prompt
      }
    ];


    for (const image of images) {

      if (
        !image ||
        !image.data
      ) {
        continue;
      }


      const mime =
        String(
          image.mimeType ||
          "image/jpeg"
        );


      const mimeType =
        mime.startsWith("image/")
          ? mime
          : "image/jpeg";


      parts.push({

        inline_data: {

          mime_type:
            mimeType,

          data:
            String(image.data)

        }

      });

    }


    if (parts.length <= 1) {

      return res.status(400).json({
        error: "PROCESSING_FAILED"
      });

    }


    /* =========================
       GEMINI REQUEST
    ========================= */

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;


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

                temperature: 0,

                responseMimeType:
                  "application/json"

              }

            })

        }
      );


    const raw =
      await response.text();


    let data = {};

    try {

      data =
        JSON.parse(raw);

    } catch {

      data = {};

    }


    /* =========================
       HIDE GEMINI ERROR
    ========================= */

    if (!response.ok) {

      console.error(
        "Gemini API error:",
        response.status,
        data?.error?.message || raw
      );


      return res.status(500).json({
        error: "PROCESSING_FAILED"
      });

    }


    /* =========================
       GET RESPONSE
    ========================= */

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
        "Gemini returned empty response."
      );


      return res.status(500).json({
        error: "PROCESSING_FAILED"
      });

    }


    /* =========================
       PARSE JSON
    ========================= */

    let parsed;


    try {

      parsed =
        JSON.parse(text);

    } catch {

      const match =
        text.match(
          /\{[\s\S]*\}/
        );


      if (!match) {

        console.error(
          "Invalid Gemini JSON."
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

      } catch {

        console.error(
          "Could not parse Gemini JSON."
        );


        return res.status(500).json({
          error: "PROCESSING_FAILED"
        });

      }

    }


    /* =========================
       CLEAN RECORDS
    ========================= */

    const records =
      Array.isArray(
        parsed?.records
      )

      ? parsed.records
          .map(
            item => {

              const name =
                String(
                  item?.name || ""
                ).trim();


              const weight =
                Number(
                  item?.weight
                );


              return {
                name,
                weight
              };

            }
          )
          .filter(
            item =>
              item.name &&
              Number.isFinite(
                item.weight
              ) &&
              item.weight >= 0
          )

      : [];


    /* =========================
       SUCCESS
    ========================= */

    return res.status(200).json({
      records
    });


  } catch (error) {

    /*
      FULL ERROR ONLY IN VERCEL LOGS.
      NEVER SEND error.message TO USER.
    */

    console.error(
      "OCR SERVER ERROR:",
      error
    );


    return res.status(500).json({
      error: "PROCESSING_FAILED"
    });

  }

        }
