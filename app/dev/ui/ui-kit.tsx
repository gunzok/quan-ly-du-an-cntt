"use client";

import type { ReactNode } from "react";
import { Avatar, AvatarGroup } from "@/components/ui/avatar";
import {
  Badge,
  NewBadge,
  PriorityBadge,
  StatusBadge,
  type TaskPriority,
  type TaskStatus,
} from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { strings } from "@/lib/strings";
import { ThemeSwitch } from "./theme-switch";

const t = strings.devUi;
const s = t.sample;

const statuses = Object.keys(strings.ui.status) as TaskStatus[];
const priorities = Object.keys(strings.ui.priority) as TaskPriority[];
const priorityOptions = priorities.map((value) => ({
  value,
  label: strings.ui.priority[value],
}));

export function UiKit() {
  return (
    <ToastProvider>
      <main className="flex-1 bg-canvas p-0 lg:p-3">
        <div className="min-h-full bg-bg lg:rounded-xl lg:border lg:border-solid lg:border-border">
          <header className="blueprint-grid flex flex-col gap-4 border-0 border-b border-solid border-border px-4 py-6 sm:px-7">
            <p className="label">{t.eyebrow}</p>
            <h1 className="font-display text-display-sm text-text sm:text-display-lg">
              {t.pageTitle}
              <span aria-hidden="true" className="text-accent">
                .
              </span>
            </h1>
            <p className="max-w-2xl text-text-muted">{t.intro}</p>
            <ThemeSwitch />
          </header>

          <div className="flex flex-col gap-10 px-4 py-6 sm:px-7">
            <Section title={t.sections.buttons}>
              <Row>
                <Button trailing="→">{s.primary}</Button>
                <Button variant="secondary" trailing="→">
                  {s.secondary}
                </Button>
                <Button variant="danger">{s.danger}</Button>
                <Button variant="text" trailing="↗">
                  {s.text}
                </Button>
              </Row>
              <Row>
                <Button loading loadingText={s.saving}>
                  {s.primary}
                </Button>
                <Button variant="secondary" loading>
                  {s.secondary}
                </Button>
                <Button disabled>{s.disabled}</Button>
                <Button variant="secondary" disabled>
                  {s.disabled}
                </Button>
                <Button variant="danger" disabled>
                  {s.disabled}
                </Button>
              </Row>
            </Section>

            <Section title={t.sections.fields}>
              <div className="grid gap-6 sm:grid-cols-2">
                <Field label={s.nameLabel} hint={s.nameHint}>
                  {(control) => (
                    <Input {...control} placeholder={s.namePlaceholder} />
                  )}
                </Field>
                <Field label={s.codeLabel} error={s.codeError}>
                  {(control) => <Input {...control} defaultValue="QLDA" />}
                </Field>
                <Field label={s.disabledLabel}>
                  {(control) => (
                    <Input
                      {...control}
                      disabled
                      defaultValue={s.disabledValue}
                    />
                  )}
                </Field>
                <Field label={s.selectLabel}>
                  {(control) => (
                    <Select
                      {...control}
                      options={priorityOptions}
                      placeholder={s.selectPlaceholder}
                      defaultValue=""
                    />
                  )}
                </Field>
                <Field label={s.descriptionLabel} className="sm:col-span-2">
                  {(control) => <Textarea {...control} />}
                </Field>
              </div>
            </Section>

            <Section title={t.sections.choices}>
              <div className="grid gap-x-8 sm:grid-cols-2">
                <div className="flex flex-col">
                  <Checkbox label={s.checkboxLabel} />
                  <Checkbox label={s.checkboxCheckedLabel} defaultChecked />
                  <Checkbox label={s.checkboxDisabledLabel} disabled />
                </div>
                <div className="flex flex-col">
                  <Switch label={s.switchLabel} />
                  <Switch label={s.switchCheckedLabel} defaultChecked />
                  <Switch label={s.switchDisabledLabel} disabled />
                </div>
              </div>
            </Section>

            <Section title={t.sections.badges}>
              <Row>
                <NewBadge />
                <Badge>{s.label}</Badge>
                {statuses.map((status) => (
                  <StatusBadge key={status} status={status} />
                ))}
              </Row>
              <Row>
                {priorities.map((priority) => (
                  <PriorityBadge key={priority} priority={priority} />
                ))}
              </Row>
            </Section>

            <Section title={t.sections.avatars}>
              <Row>
                <Avatar name={s.avatarPeople[0]} size="sm" />
                <Avatar name={s.avatarPeople[1]} />
                <Avatar name={s.avatarPeople[2]} size="lg" />
                <AvatarGroup label={s.avatarGroupLabel}>
                  {s.avatarPeople.map((name) => (
                    <Avatar key={name} name={name} />
                  ))}
                </AvatarGroup>
              </Row>
            </Section>

            <Section title={t.sections.feedback}>
              <Row>
                <DialogDemo />
                <ToastDemo />
              </Row>
              <SkeletonGroup label={s.skeletonLabel} className="max-w-md">
                <Skeleton className="w-2/3" />
                <Skeleton />
                <Skeleton className="w-5/6" />
              </SkeletonGroup>
            </Section>

            <Section title={t.sections.tabs}>
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">{s.tabOverview}</TabsTrigger>
                  <TabsTrigger value="tasks">{s.tabTasks}</TabsTrigger>
                  <TabsTrigger value="members">{s.tabMembers}</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">{s.tabOverviewText}</TabsContent>
                <TabsContent value="tasks">{s.tabTasksText}</TabsContent>
                <TabsContent value="members">{s.tabMembersText}</TabsContent>
              </Tabs>
            </Section>

            <Section title={t.sections.empty}>
              <EmptyState
                headingLevel={3}
                title={s.emptyTitle}
                description={s.emptyDescription}
                action={<Button trailing="→">{s.emptyAction}</Button>}
              />
            </Section>
          </div>
        </div>
      </main>
    </ToastProvider>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="label flex items-center gap-2">
        <span aria-hidden="true" className="size-1.5 rounded-pill bg-accent" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

function DialogDemo() {
  const { toast } = useToast();
  return (
    <ConfirmDialog
      trigger={<Button variant="danger">{s.openDialog}</Button>}
      title={s.dialogTitle}
      description={s.dialogDescription}
      confirmLabel={s.dialogConfirm}
      onConfirm={async () => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        toast({ title: s.dialogDone, tone: "success" });
      }}
    />
  );
}

function ToastDemo() {
  const { toast } = useToast();
  return (
    <>
      <Button
        variant="secondary"
        onClick={() => toast({ title: s.toastSuccessText, tone: "success" })}
      >
        {s.toastSuccess}
      </Button>
      <Button
        variant="secondary"
        onClick={() => toast({ title: s.toastErrorText, tone: "error" })}
      >
        {s.toastError}
      </Button>
      <Button
        variant="secondary"
        onClick={() => toast({ title: s.toastWarningText, tone: "warning" })}
      >
        {s.toastWarning}
      </Button>
    </>
  );
}
