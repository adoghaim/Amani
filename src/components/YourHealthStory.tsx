import { Card } from './Card';
import type { HealthStory } from '../lib/insights/buildHealthStory';

interface YourHealthStoryProps {
  story: HealthStory;
}

export function YourHealthStory({ story }: YourHealthStoryProps) {
  if (story.sentences.length === 0) return null;

  const paragraph = story.sentences.map(s => s.text).join(' ');

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base text-theme-text">Your health story</h2>
        <p className="text-xs text-theme-muted-text-2 mt-0.5">
          A narrative summary of what this report shows
        </p>
      </div>
      <Card>
        <p className="text-[15px] text-theme-text leading-relaxed max-w-prose">
          {paragraph}
        </p>
      </Card>
    </section>
  );
}
