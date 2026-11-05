"use client";

import type { MonthFacet } from "@omoide/core";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Aperture, ArrowUpRight, Calendar, ChevronRight, Images, Settings, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
} from "~/components/ui/sidebar";

function formatCount(value: number) {
  return value.toLocaleString("en-US");
}

interface DateFilterContextValue {
  month: string;
  date: string;
  months: readonly MonthFacet[];
  totalCount: number | undefined;
  setMonth: (month: string) => void;
  setDate: (date: string) => void;
  selectMonth: (month: string) => void;
  selectDate: (date: string) => void;
  clearDateFilter: () => void;
  setTimelineFacets: (months: readonly MonthFacet[], totalCount: number) => void;
}

const DateFilterContext = createContext<DateFilterContextValue | null>(null);

export function DateFilterProvider({ children }: { children: ReactNode }) {
  const [month, setMonth] = useState("");
  const [date, setDate] = useState("");
  const [months, setMonths] = useState<readonly MonthFacet[]>([]);
  const [totalCount, setTotalCount] = useState<number | undefined>(undefined);

  const selectMonth = useCallback(
    (nextMonth: string) => {
      setDate("");
      setMonth((prev) => (prev === nextMonth && !date ? "" : nextMonth));
    },
    [date],
  );

  const selectDate = useCallback((nextDate: string) => {
    setMonth("");
    setDate((prev) => (prev === nextDate ? "" : nextDate));
  }, []);

  const clearDateFilter = useCallback(() => {
    setMonth("");
    setDate("");
  }, []);

  const setTimelineFacets = useCallback(
    (nextMonths: readonly MonthFacet[], nextTotalCount: number) => {
      setMonths(nextMonths);
      setTotalCount(nextTotalCount);
    },
    [],
  );

  const value = useMemo<DateFilterContextValue>(
    () => ({
      month,
      date,
      months,
      totalCount,
      setMonth,
      setDate,
      selectMonth,
      selectDate,
      clearDateFilter,
      setTimelineFacets,
    }),
    [month, date, months, totalCount, selectMonth, selectDate, clearDateFilter, setTimelineFacets],
  );

  return <DateFilterContext.Provider value={value}>{children}</DateFilterContext.Provider>;
}

export function useDateFilter() {
  const context = useContext(DateFilterContext);
  if (!context) {
    throw new Error("useDateFilter must be used within a DateFilterProvider.");
  }
  return context;
}

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navigate = useNavigate();
  const {
    month: selectedMonth,
    date: selectedDate,
    months,
    totalCount,
    selectMonth,
    selectDate,
    clearDateFilter,
  } = useDateFilter();

  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});

  // Auto-open the first month when facets arrive, or the month containing the active filter.
  useEffect(() => {
    const activeMonth = selectedMonth || (selectedDate ? selectedDate.slice(0, 7) : "");
    if (activeMonth) {
      setOpenMonths((prev) => (prev[activeMonth] ? prev : { ...prev, [activeMonth]: true }));
      return;
    }
    const firstMonth = months[0]?.month;
    if (firstMonth) {
      setOpenMonths((prev) => (Object.keys(prev).length > 0 ? prev : { [firstMonth]: true }));
    }
  }, [months, selectedMonth, selectedDate]);

  function handleSelectMonth(targetMonth: string) {
    setOpenMonths((prev) => ({ ...prev, [targetMonth]: true }));
    selectMonth(targetMonth);
    if (pathname !== "/") {
      void navigate({ to: "/" });
    }
  }

  function handleSelectDate(targetDate: string) {
    const parentMonth = targetDate.slice(0, 7);
    setOpenMonths((prev) => ({ ...prev, [parentMonth]: true }));
    selectDate(targetDate);
    if (pathname !== "/") {
      void navigate({ to: "/" });
    }
  }

  function handleSelectAllDates() {
    clearDateFilter();
    if (pathname !== "/") {
      void navigate({ to: "/" });
    }
  }

  const hasDateFilter = Boolean(selectedMonth || selectedDate);

  return (
    <Sidebar {...props}>
      <SidebarHeader className="h-12 shrink-0 flex-row items-center justify-between border-b border-sidebar-border px-3 py-0">
        <Link
          to="/"
          className="flex min-w-0 items-center gap-2 rounded-md py-1 text-ink transition-colors hover:text-accent"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-ink text-white shadow-2xs">
            <Aperture className="size-3.5" aria-hidden="true" />
          </span>
          <span className="truncate text-sm font-semibold tracking-tight">Omoide</span>
        </Link>
        <span
          title="Sony α7C (ILCE-7C)"
          className="shrink-0 rounded-sm border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] font-medium text-ink-muted"
        >
          ILCE-7C
        </span>
      </SidebarHeader>

      <SidebarContent className="py-1">
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu aria-label="Main">
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname === "/"}
                  render={<Link to="/" activeOptions={{ exact: true, includeSearch: false }} />}
                >
                  <Images aria-hidden="true" />
                  <span>Library</span>
                  {totalCount !== undefined && (
                    <SidebarMenuBadge>{formatCount(totalCount)}</SidebarMenuBadge>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={pathname.startsWith("/settings")}
                  render={<Link to="/settings" />}
                >
                  <Settings aria-hidden="true" />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator />

        <SidebarGroup className="min-h-0 flex-1">
          <SidebarGroupLabel>Timeline</SidebarGroupLabel>
          {hasDateFilter && (
            <SidebarGroupAction
              type="button"
              aria-label="Clear date filter"
              title="Clear date filter"
              onClick={handleSelectAllDates}
            >
              <X aria-hidden="true" />
            </SidebarGroupAction>
          )}
          <SidebarGroupContent>
            <SidebarMenu aria-label="Timeline">
              <SidebarMenuItem>
                <SidebarMenuButton
                  type="button"
                  isActive={pathname === "/" && !hasDateFilter}
                  onClick={handleSelectAllDates}
                >
                  <Calendar aria-hidden="true" />
                  <span>All dates</span>
                  {totalCount !== undefined && (
                    <SidebarMenuBadge>{formatCount(totalCount)}</SidebarMenuBadge>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>

              {months.map((item) => {
                const isOpen = Boolean(openMonths[item.month]);
                const isMonthActive = selectedMonth === item.month && !selectedDate;
                const hasActiveChild =
                  Boolean(selectedDate) && selectedDate.startsWith(`${item.month}-`);

                return (
                  <Collapsible
                    key={item.month}
                    open={isOpen}
                    onOpenChange={(nextOpen) =>
                      setOpenMonths((prev) => ({ ...prev, [item.month]: nextOpen }))
                    }
                    render={<SidebarMenuItem />}
                  >
                    <div className="relative flex items-center">
                      <CollapsibleTrigger
                        render={
                          <button
                            type="button"
                            aria-label={`Toggle dates for ${item.month}`}
                            className="absolute left-1.5 z-10 flex size-5 items-center justify-center rounded-sm text-ink-faint transition-colors hover:bg-sidebar-accent hover:text-ink [&[aria-expanded=true]>svg]:rotate-90"
                          />
                        }
                      >
                        <ChevronRight
                          className="size-3.5 transition-transform duration-150"
                          aria-hidden="true"
                        />
                      </CollapsibleTrigger>

                      <SidebarMenuButton
                        type="button"
                        isActive={isMonthActive}
                        onClick={() => handleSelectMonth(item.month)}
                        className={`pl-7 ${hasActiveChild ? "font-medium text-ink" : ""}`}
                      >
                        <span className="font-mono text-xs tabular-nums">{item.month}</span>
                        <SidebarMenuBadge>{formatCount(item.count)}</SidebarMenuBadge>
                      </SidebarMenuButton>
                    </div>

                    <CollapsibleContent>
                      <SidebarMenuSub className="ml-3.5 pr-0 pl-3">
                        {item.dates.map((d) => {
                          const shortDate = d.date.slice(5);
                          const isDateActive = selectedDate === d.date;
                          return (
                            <SidebarMenuSubItem key={d.date}>
                              <SidebarMenuSubButton
                                isActive={isDateActive}
                                aria-label={`Filter by ${d.date}`}
                                onClick={() => handleSelectDate(d.date)}
                                className="pr-3.5"
                              >
                                <span className="font-mono text-xs tabular-nums">{shortDate}</span>
                                <span
                                  className={`font-mono text-[11px] tabular-nums ${
                                    isDateActive ? "text-accent" : "text-ink-faint"
                                  }`}
                                >
                                  {formatCount(d.count)}
                                </span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<a href="/api/scalar" target="_blank" rel="noreferrer" />}>
              <span>API docs</span>
              <ArrowUpRight className="ml-auto size-3.5 text-ink-faint" aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
