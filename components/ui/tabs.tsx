"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

/**
 * Tab dựa trên Radix Tabs (role tablist/tab/tabpanel, phím mũi tên, Home/End).
 * Tab đang chọn: nền bg-muted, vạch dưới 2 px primary, chữ đậm (không chỉ dựa vào màu).
 */
export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: TabsPrimitive.TabsListProps) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex flex-wrap gap-1 border-0 border-b border-solid border-border",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: TabsPrimitive.TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px inline-flex min-h-11 cursor-pointer items-center rounded-t-md border-0 border-b-2 border-solid border-transparent bg-transparent px-3 font-sans text-sm text-text-muted hover:bg-bg-muted hover:text-text sm:min-h-9",
        "data-[state=active]:border-primary data-[state=active]:bg-bg-muted data-[state=active]:font-semibold data-[state=active]:text-text",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: TabsPrimitive.TabsContentProps) {
  return (
    <TabsPrimitive.Content
      className={cn("pt-4 text-sm", className)}
      {...props}
    />
  );
}
