// api/ocr.js
// Vercel Serverless Function
// Gemini API key is kept on the server.
// Technical Gemini/API errors are NEVER exposed to users.

export default async function handler(req, res) {

  // --------------------------------
  // METHOD CHECK
  // --------------------------------

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'REQUEST_NOT_ALLOWED'
    });
  }


  try {

    // --------------------------------
    // READ REQUEST
    // --------------------------------

    const {
      images,
      names = [],
      defaultRate = 0
    } = req.body || {};


    // --------------------------------
    // API KEY CHECK
    // --------------------------------

    if (!process.env.GEMINI_API_KEY) {

      console.error(
        'GEMINI_API_KEY is missing.'
      );

      return res.status(500).json({
        error: 'PROCESSING_FAILED'
      });
    }


    // --------------------------------
    // IMAGE CHECK
    // --------------------------------

    if (
      !Array.isArray(images) ||
      images.length === 0
    ) {

      return res.status(400).json({
        error: 'NO_IMAGES'
      });
    }


    if (images.length > 12) {

      return res.status(400).json({
        error: 'TOO_MANY_IMAGES'
      });
    }


    // --------------------------------
    // CURRENT GEMINI MODEL
    // --------------------------------

    const model =
      'gemini-3.6-flash';


    // --------------------------------
    // NAME MASTER
    // --------------------------------

    const master =
      Array.isArray(names)
        ? names
            .filter(
              name =>
                typeof name === 'string' &&
                name.trim()
            )
            .map(
              name =>
                name.trim()
            )
            .slice(0, 500)
        : [];


    // --------------------------------
    // OCR INSTRUCTIONS
    // --------------------------------

    const prompt = `
You are a highly accurate OCR and data extraction assistant for handwritten Pakistani cotton purchase records.

Read ALL supplied notebook images carefully.

The handwriting may contain:

- Urdu
- Roman Urdu
- Arabic/Urdu digits
- English digits
- Mixed Urdu and numbers

Your task is to extract every visible cotton record.

Return ONLY valid JSON in exactly this format:

{"records":[{"name":"...","weight":0}]}

IMPORTANT RULES:

1. Extract every visible record row.

2. Do NOT invent records.

3. Do NOT skip a clearly readable record.

4. Weight must be a numeric value representing kilograms.

5. Convert Urdu/Arabic digits into normal numbers.

6. Example:
   ۱۲.۵ = 12.5
   ۲۵ = 25
   ۳۶ = 36

7. A row may contain a leading code such as:
   0-36
   1-25
   03-40

   Ignore such codes unless the code is clearly part of the person's name.

8. The person's name must be separated from the weight.

9. Use the supplied Name Master as a strong spelling/reference list.

10. If a handwritten name appears to match a Name Master entry, use the Name Master spelling when reasonably supported.

11. If the handwriting is unclear and there is no reasonably supported Name Master match, preserve the best readable spelling.

12. Do not create a name just because it exists in the Name Master. Only return a name when an actual record row is visible.

13. Do not return explanations.

14. Do not return markdown.

15. Do not return code fences.

16. Return JSON only.

Name Master:
${JSON.stringify(master)}

Default rate:
${Number(defaultRate) || 0}

Do not include rate in the returned JSON.
`;


    // --------------------------------
    // CREATE IMAGE PARTS
    // --------------------------------

    const parts = [
      {
        text: prompt
      }
    ];


    for (const img of images) {

      if (
        !img ||
        !img.data
      ) {
        continue;
      }


      const mime =
        String(
          img.mimeType ||
          'image/jpeg'
        );


      const mimeType =
        mime.startsWith('image/')
          ? mime
          : 'image/jpeg';


      parts.push({

        inline_data: {

          mime_type:
            mimeType,

          data:
            String(img.data)

        }

      });

    }


    // --------------------------------
    // VALIDATE IMAGE PARTS
    // --------------------------------

    if (parts.length === 1) {

      return res.status(400).json({
        error: 'INVALID_IMAGES'
      });
    }


    // --------------------------------
    // GEMINI API
    // --------------------------------

    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;


    const response =
      await fetch(
        endpoint,
        {

          method: 'POST',

          headers: {

            'Content-Type':
              'application/json',

            'x-goog-api-key':
              process.env.GEMINI_API_KEY

          },

          body: JSON.stringify({

            contents: [
              {
                role: 'user',
                parts
              }
            ],

            generationConfig: {

              responseMimeType:
                'application/json'

            }

          })

        }
      );


    // --------------------------------
    // READ GEMINI RESPONSE
    // --------------------------------

    const raw =
      await response.text();


    let data = {};

    try {

      data =
        JSON.parse(raw);

    } catch {

      data = {};

    }


    // --------------------------------
    // HIDE GEMINI ERROR
    // --------------------------------

    if (!response.ok) {

      // Full technical information goes
      // ONLY to Vercel server logs.

      console.error(
        'Gemini API failed:',
        response.status,
        data?.error?.message || raw
      );


      // User sees ONLY generic message.

      return res.status(500).json({
        error: 'PROCESSING_FAILED'
      });
    }


    // --------------------------------
    // GET MODEL TEXT
    // --------------------------------

    const text =
      data
        ?.candidates?.[0]
        ?.content?.parts
        ?.map(
          part =>
            part?.text || ''
        )
        .join('')
        .trim() || '';


    if (!text) {

      console.error(
        'Gemini returned empty OCR result.'
      );

      return res.status(500).json({
        error: 'PROCESSING_FAILED'
      });
    }


    // --------------------------------
    // PARSE JSON
    // --------------------------------

    let parsed;


    try {

      parsed =
        JSON.parse(text);

    } catch {

      // Sometimes models may still return
      // extra characters around JSON.

      const match =
        text.match(
          /\{[\s\S]*\}/
        );


      if (!match) {

        console.error(
          'Gemini returned invalid JSON.'
        );

        return res.status(500).json({
          error: 'PROCESSING_FAILED'
        });
      }


      try {

        parsed =
          JSON.parse(
            match[0]
          );

      } catch {

        console.error(
          'OCR JSON parsing failed.'
        );

        return res.status(500).json({
          error: 'PROCESSING_FAILED'
        });
      }

    }


    // --------------------------------
    // CLEAN RECORDS
    // --------------------------------

    const records =
      Array.isArray(
        parsed?.records
      )

        ? parsed.records
            .map(
              item => {

                const name =
                  String(
                    item?.name || ''
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


    // --------------------------------
    // SUCCESS
    // --------------------------------

    return res.status(200).json({
      records
    });


  } catch (error) {

    // --------------------------------
    // SERVER LOG ONLY
    // --------------------------------

    console.error(
      'OCR SERVER ERROR:',
      error
    );


    // NEVER expose:
    // error.message
    // Gemini model name
    // API URL
    // API response
    // API key
    // internal server details

    return res.status(500).json({
      error: 'PROCESSING_FAILED'
    });

  }

}
