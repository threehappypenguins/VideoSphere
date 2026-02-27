// =============================================================================
// ABOUT PAGE
// =============================================================================
// Tells visitors about your product, team, and mission.
//
// STUDENT: Replace ALL placeholder content with your actual information:
//   - Mission and vision statements
//   - Team member names, roles, and photos
//   - Your product's origin story
// =============================================================================

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'About',
  description: 'Learn about [Your App Name] — our mission, team, and story.',
};

// STUDENT: Replace with your actual team members
const team = [
  { name: '[Team Member 1]', role: '[Role / Title]', bio: '[Short bio about this team member]' },
  { name: '[Team Member 2]', role: '[Role / Title]', bio: '[Short bio about this team member]' },
  { name: '[Team Member 3]', role: '[Role / Title]', bio: '[Short bio about this team member]' },
  { name: '[Team Member 4]', role: '[Role / Title]', bio: '[Short bio about this team member]' },
];

export default function AboutPage() {
  return (
    <div className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        {/* --- Mission / Vision --- */}
        <section className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            About [Your App Name]
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            [Your mission statement — what problem does your product solve and why does your team
            care about solving it? Write 2-3 sentences that capture your purpose.]
          </p>
        </section>

        {/* --- Story --- */}
        <section className="mt-20">
          <h2 className="text-2xl font-bold text-foreground">Our Story</h2>
          <div className="mt-6 space-y-4 text-muted-foreground">
            <p>
              [Tell the story of how your product came to be. What inspired you to build it? What
              problem did you see that needed solving?]
            </p>
            <p>
              [Describe your journey — the challenges you faced, the decisions you made, and where
              you are today. This is your chance to connect with visitors on a personal level.]
            </p>
            <p>
              [Share your vision for the future — where is the product heading? What impact do you
              want to have?]
            </p>
          </div>
        </section>

        {/* --- Team --- */}
        <section className="mt-20">
          <h2 className="text-center text-2xl font-bold text-foreground">Meet the Team</h2>
          <p className="mt-4 text-center text-muted-foreground">
            [A brief intro about your team — what brings you together and what you&apos;re building]
          </p>

          <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2">
            {team.map((member) => (
              <div key={member.name} className="rounded-xl border border-border p-6 text-center">
                {/* STUDENT: Replace this placeholder with actual team photos */}
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-muted text-2xl">
                  👤
                </div>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{member.name}</h3>
                <p className="text-sm font-medium text-primary">{member.role}</p>
                <p className="mt-2 text-sm text-muted-foreground">{member.bio}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
