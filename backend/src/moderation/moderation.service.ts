import { Injectable } from '@nestjs/common';

interface ModerationResult {
  allowed: boolean;
  reason: string | null;
}

@Injectable()
export class ModerationService {
  private readonly serviceUrl =
    process.env.MODERATION_SERVICE_URL || 'http://localhost:4000';

  async moderate(username: string, content: string): Promise<ModerationResult> {
    const response = await fetch(`${this.serviceUrl}/moderate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, content }),
    });

    if (!response.ok) {
      throw new Error(`moderation service responded with ${response.status}`);
    }

    const result = (await response.json()) as ModerationResult;
    return result;
  }
}
