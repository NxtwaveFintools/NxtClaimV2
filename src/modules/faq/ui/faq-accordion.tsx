"use client";

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import type { FaqItem } from "@/modules/faq/data/faq-data";

type FaqAccordionProps = {
  items: FaqItem[];
};

export function FaqAccordion({ items }: FaqAccordionProps) {
  if (items.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
        No FAQs available.
      </p>
    );
  }

  return (
    <Accordion type="single" collapsible className="w-full">
      {items.map((item) => (
        <AccordionItem
          key={item.id}
          value={`faq-${item.id}`}
          className="border-zinc-200 dark:border-zinc-800"
        >
          <AccordionTrigger className="py-4 text-left text-base font-semibold text-zinc-900 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:text-zinc-100">
            {item.question}
          </AccordionTrigger>
          <AccordionContent className="pb-4 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">
            {item.answer}
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
