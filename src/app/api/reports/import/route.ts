import { RATE_LIMITS } from "@/lib/rate-limit";
import { errors } from "@/lib/errors";
import { importContactsCsv } from "@/server/services/reports";
import { enforceRateLimit, handler, jsonOk, requireAuth } from "@/server/http";

const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  return handler(async () => {
    const auth = await requireAuth();
    enforceRateLimit(request, RATE_LIMITS.import, "import", auth.userId);

    const contentType = request.headers.get("content-type") ?? "";
    let csv: string;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw errors.validation("Envie um arquivo CSV.");
      if (file.size > MAX_BYTES) {
        throw errors.validation("O arquivo excede o limite de 5 MB.");
      }
      csv = await file.text();
    } else {
      csv = await request.text();
      if (csv.length > MAX_BYTES) {
        throw errors.validation("O arquivo excede o limite de 5 MB.");
      }
    }

    return jsonOk(await importContactsCsv(auth, csv));
  });
}
