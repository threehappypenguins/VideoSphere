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

import { CardNoiseBackground, PAGE_SEEDS } from '@/components/ui/GaussianNoiseBackground';

export const metadata: Metadata = {
  title: 'About',
  description: 'Learn about VideoSphere — our mission, team, and story.',
};

// Core VideoSphere team members
const team = [
  {
    name: 'Sarah Poulin',
    role: 'Project Lead & Full-Stack Developer',
    bio: 'Sarah is passionate about building innovative solutions and leading the team to success.',
  },
  {
    name: 'Sonia Kakkar',
    role: 'Frontend Developer',
    bio: 'Sonia is a skilled frontend developer with a keen eye for design and user experience.',
  },
  {
    name: 'Christian Hansen',
    role: 'Full-Stack Developer',
    bio: 'Christian is a full-stack developer who has a passion for building fun and engaging web applications.',
  },
  {
    name: 'Daryan Wynter',
    role: 'Frontend Developer',
    bio: 'Daryan is a creative frontend developer focused on crafting intuitive and engaging user experiences.',
  },
];

export default function AboutPage() {
  return (
    <div className="px-4 py-20 font-sans sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        {/* --- Mission / Vision --- */}
        <section className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            About VideoSphere
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            VideoSphere lets video creators upload once and distribute everywhere. We&apos;re
            building this as our capstone project at NSCC to solve the pain of manually uploading to
            multiple platforms.
          </p>
        </section>

        {/* --- Story --- */}
        <section className="mt-20">
          <h2 className="text-2xl font-bold text-foreground">Our Story</h2>
          <div className="mt-6 space-y-4 text-muted-foreground">
            <p>
              VideoSphere started as a capstone project at NSCC, born out of a frustration we all
              shared — spending hours uploading the same video to YouTube, Vimeo, and other
              platforms one by one.
            </p>
            <p>
              As a team of four students, we collaborated to design and build a platform that solves
              this problem by letting creators upload once and distribute everywhere automatically.
            </p>
          </div>
        </section>

        {/* --- Team --- */}
        <section className="mt-20">
          <h2 className="text-center text-2xl font-bold text-foreground">Meet the Team</h2>
          <p className="mt-4 text-center text-muted-foreground">
            Four NSCC students united by a shared goal — building VideoSphere to make multi-platform
            video distribution effortless.
          </p>

          <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2">
            {team.map((member) => (
              <div
                key={member.name}
                className="relative isolate overflow-hidden rounded-xl border border-border bg-background p-6 text-center"
              >
                <CardNoiseBackground seed={PAGE_SEEDS['/about']} />
                {/* STUDENT: Replace this placeholder with actual team photos */}
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-muted text-2xl">
                  👤
                </div>
                <h3 className="mt-4 text-lg font-semibold text-foreground">{member.name}</h3>
                <p className="text-m font-bold text-primary">{member.role}</p>
                <p className="mt-2 text-sm text-muted-foreground">{member.bio}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
