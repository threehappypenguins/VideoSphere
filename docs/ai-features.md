# AI Features Guide

## Why AI Features in SaaS?

AI-powered features are increasingly expected in modern SaaS products. Adding an AI feature to your project demonstrates understanding of current technology trends and gives your users a more intelligent, personalized experience.

Your project requirement: **implement at least one AI-powered feature for end users.**

## AI Feature Ideas

Choose one or more features that make sense for your product:

| Feature                      | Description                                     | Complexity |
| ---------------------------- | ----------------------------------------------- | ---------- |
| **Chatbot / Assistant**      | AI-powered Q&A or help assistant                | Medium     |
| **Content Generation**       | Generate text (descriptions, summaries, emails) | Low-Medium |
| **Smart Search**             | Semantic search that understands intent         | Medium     |
| **Recommendations**          | Personalized suggestions based on user data     | Medium     |
| **Data Summarization**       | Summarize long content into key points          | Low        |
| **Image Analysis**           | Describe or categorize uploaded images          | Medium     |
| **Automated Categorization** | Auto-tag or classify user content               | Low-Medium |

## Recommended Stack: OpenRouter + Vercel AI SDK

### OpenRouter (API Provider)

[OpenRouter](https://openrouter.ai/) is the **recommended API provider** for this project.

**Why OpenRouter?**

- **Single API** that routes to many models (GPT-4o, Claude, Llama, Mixtral, etc.)
- **Free tier models available** — perfect for student projects with no budget
- **Compatible with OpenAI SDK format** — easy to use with existing tutorials
- **No vendor lock-in** — switch models by changing one string

**Getting Started:**

1. Go to [openrouter.ai](https://openrouter.ai/) and create an account
2. Go to **Keys** in the dashboard
3. Create a new API key
4. Add it to your `.env.local` file:

```bash
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

**Free Models to Start With:**

- `meta-llama/llama-3.1-8b-instruct:free` — good general purpose
- `google/gemma-2-9b-it:free` — Google's open model
- `mistralai/mistral-7b-instruct:free` — fast and capable

Check [openrouter.ai/models](https://openrouter.ai/models) for the current list of free models.

### Vercel AI SDK (Integration Layer)

The [Vercel AI SDK](https://sdk.vercel.ai/) is the **recommended way** to integrate AI into your Next.js app.

**Why Vercel AI SDK?**

- Built specifically for Next.js App Router
- Streaming responses (text appears word by word — great UX)
- `useChat` hook for conversational UI
- `useCompletion` hook for single completions
- Works with OpenRouter via the OpenAI-compatible provider

**Installation:**

```bash
pnpm add ai @ai-sdk/openai
```

## Implementation Pattern

Here's the conceptual pattern for adding an AI feature. You'll implement the details yourself.

### 1. Environment Variable

```bash
# .env.local
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

### 2. API Route (Server-Side)

Create an API route that communicates with OpenRouter:

```typescript
// app/api/chat/route.ts
import { createOpenAI } from '@ai-sdk/openai';
import { streamText } from 'ai';

// Configure OpenRouter as the provider
const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openrouter('meta-llama/llama-3.1-8b-instruct:free'),
    messages,
  });

  return result.toDataStreamResponse();
}
```

### 3. Client Component (User Interface)

```tsx
'use client';

import { useChat } from 'ai/react';

export default function ChatInterface() {
  const { messages, input, handleInputChange, handleSubmit } = useChat();

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          <strong>{m.role === 'user' ? 'You' : 'AI'}:</strong>
          <p>{m.content}</p>
        </div>
      ))}

      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} placeholder="Ask something..." />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
```

This is a simplified example. Your implementation will need proper styling, error handling, loading states, and integration with your product.

## Important Considerations

### Cost Management

- Start with **free models** during development
- Set a **monthly spending limit** on your OpenRouter account
- Consider caching common responses to reduce API calls
- Implement **rate limiting** on your API routes to prevent abuse

### Rate Limiting

Protect your API routes from excessive usage:

```typescript
// Basic approach: limit requests per user
// STUDENT: implement rate limiting for your AI endpoints
// Options: Upstash rate limit, custom in-memory counter, or middleware
```

### Responsible AI Design

- **Set expectations** — tell users they're interacting with AI
- **Handle errors gracefully** — API calls can fail
- **Don't store sensitive data** in AI prompts
- **Add a system prompt** to keep responses on-topic for your product
- **Consider content moderation** for user-generated prompts

### System Prompts

Always set a system prompt to guide the AI's behavior:

```typescript
const result = streamText({
  model: openrouter('meta-llama/llama-3.1-8b-instruct:free'),
  system: `You are a helpful assistant for [Your App Name]. 
    You help users with [specific domain]. 
    Keep responses concise and relevant.
    Do not discuss topics outside of [your domain].`,
  messages,
});
```

## Useful Resources

- [Vercel AI SDK Documentation](https://sdk.vercel.ai/docs)
- [OpenRouter Documentation](https://openrouter.ai/docs)
- [AI SDK Examples](https://sdk.vercel.ai/examples)
- [OpenAI Cookbook](https://cookbook.openai.com/) (concepts apply to OpenRouter)
