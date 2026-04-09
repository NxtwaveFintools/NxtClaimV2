"use client";

import { type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

type RouterLinkProps = {
  href: string;
  children: ReactNode;
  scroll?: boolean;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">;

export function RouterLink({ href, children, scroll = true, onClick, ...rest }: RouterLinkProps) {
  const router = useRouter();

  const onRouterLinkClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);

    if (event.defaultPrevented) {
      return;
    }

    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    router.push(href, { scroll });
  };

  return (
    <a href={href} onClick={onRouterLinkClick} {...rest}>
      {children}
    </a>
  );
}
