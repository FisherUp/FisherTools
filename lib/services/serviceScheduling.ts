import { supabase } from "../supabaseClient";

// ============================================
// 服务类型相关函数
// ============================================

/**
 * 获取所有活跃的服务类型
 */
export async function fetchServiceTypes(orgId: string) {
  const { data, error } = await supabase
    .from("service_types")
    .select("id, name, frequency, description, is_active")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * 获取所有服务类型（包括未启用的）
 */
export async function fetchAllServiceTypes(orgId: string) {
  const { data, error } = await supabase
    .from("service_types")
    .select("id, name, frequency, description, is_active, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * 创建服务类型
 */
export async function createServiceType(
  orgId: string,
  name: string,
  frequency: string,
  description?: string
) {
  const { data, error } = await supabase
    .from("service_types")
    .insert({
      org_id: orgId,
      name,
      frequency,
      description,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * 更新服务类型
 */
export async function updateServiceType(
  id: string,
  name: string,
  frequency: string,
  description?: string,
  isActive?: boolean
) {
  const { data, error } = await supabase
    .from("service_types")
    .update({
      name,
      frequency,
      description,
      is_active: isActive,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * 切换服务类型启用状态
 */
export async function toggleServiceTypeActive(id: string, isActive: boolean) {
  const { data, error } = await supabase
    .from("service_types")
    .update({ is_active: isActive })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ============================================
// 服务安排相关函数
// ============================================

/**
 * 获取指定日期范围的服务安排
 */
export async function fetchServiceAssignments(
  orgId: string,
  fromDate: string,
  toDate: string
) {
  const { data, error } = await supabase
    .from("service_assignments")
    .select(
      `
      id,
      service_date,
      sermon_title,
      notes,
      status,
      service_types (id, name, frequency),
      members (id, name)
    `
    )
    .eq("org_id", orgId)
    .gte("service_date", fromDate)
    .lte("service_date", toDate)
    .order("service_date", { ascending: true });

  if (error) throw error;
  return data || [];
}

/**
 * 创建单个服务安排
 */
export async function createServiceAssignment(
  orgId: string,
  serviceTypeId: string,
  memberId: string,
  serviceDate: string,
  sermonTitle?: string,
  notes?: string,
  status: string = "scheduled"
) {
  const { data, error } = await supabase
    .from("service_assignments")
    .insert({
      org_id: orgId,
      service_type_id: serviceTypeId,
      member_id: memberId,
      service_date: serviceDate,
      sermon_title: sermonTitle,
      notes,
      status,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * 批量创建服务安排
 */
export async function createBatchServiceAssignments(
  assignments: Array<{
    org_id: string;
    service_type_id: string;
    member_id: string;
    service_date: string;
    sermon_title?: string;
    notes?: string;
    status?: string;
  }>
) {
  const { data, error } = await supabase
    .from("service_assignments")
    .insert(assignments)
    .select();

  if (error) throw error;
  return data;
}

/**
 * 更新服务安排
 */
export async function updateServiceAssignment(
  id: string,
  serviceTypeId?: string,
  memberId?: string,
  serviceDate?: string,
  sermonTitle?: string,
  notes?: string,
  status?: string
) {
  const updates: any = {};
  if (serviceTypeId !== undefined) updates.service_type_id = serviceTypeId;
  if (memberId !== undefined) updates.member_id = memberId;
  if (serviceDate !== undefined) updates.service_date = serviceDate;
  if (sermonTitle !== undefined) updates.sermon_title = sermonTitle;
  if (notes !== undefined) updates.notes = notes;
  if (status !== undefined) updates.status = status;

  const { data, error } = await supabase
    .from("service_assignments")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * 删除服务安排
 */
export async function deleteServiceAssignment(id: string) {
  const { error } = await supabase
    .from("service_assignments")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

// ============================================
// 工作量统计相关函数
// ============================================

/**
 * 获取成员工作量统计
 */
export async function fetchMemberWorkloadStats(
  orgId: string,
  fromDate: string,
  toDate: string
) {
  // 获取所有活跃成员
  const { data: members, error: membersError } = await supabase
    .from("members")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (membersError) throw membersError;

  // 获取指定日期范围内的所有服务安排
  const { data: assignments, error: assignmentsError } = await supabase
    .from("service_assignments")
    .select(
      `
      id,
      member_id,
      service_date,
      service_types (id, name)
    `
    )
    .eq("org_id", orgId)
    .gte("service_date", fromDate)
    .lte("service_date", toDate)
    .neq("status", "cancelled");

  if (assignmentsError) throw assignmentsError;

  // 统计每个成员的工作量
  const workloadMap = new Map<
    string,
    {
      memberId: string;
      memberName: string;
      totalCount: number;
      serviceTypes: Map<string, number>;
      lastServiceDate: string | null;
    }
  >();

  // 初始化所有成员
  members?.forEach((member) => {
    workloadMap.set(member.id, {
      memberId: member.id,
      memberName: member.name,
      totalCount: 0,
      serviceTypes: new Map(),
      lastServiceDate: null,
    });
  });

  // 统计工作量
  assignments?.forEach((assignment) => {
    const workload = workloadMap.get(assignment.member_id);
    if (workload) {
      workload.totalCount++;

      const serviceTypeName = assignment.service_types?.name || "未知";
      const currentCount = workload.serviceTypes.get(serviceTypeName) || 0;
      workload.serviceTypes.set(serviceTypeName, currentCount + 1);

      if (
        !workload.lastServiceDate ||
        assignment.service_date > workload.lastServiceDate
      ) {
        workload.lastServiceDate = assignment.service_date;
      }
    }
  });

  // 计算平均工作量
  const totalAssignments = assignments?.length || 0;
  const activeMembers = members?.length || 1;
  const averageWorkload = totalAssignments / activeMembers;

  // 转换为数组并添加状态指示器
  const result = Array.from(workloadMap.values()).map((workload) => {
    let status = "balanced";
    if (workload.totalCount > averageWorkload * 1.5) {
      status = "overloaded";
    } else if (workload.totalCount < averageWorkload * 0.5) {
      status = "underutilized";
    }

    return {
      ...workload,
      serviceTypes: Array.from(workload.serviceTypes.entries()).map(
        ([name, count]) => ({ name, count })
      ),
      status,
      averageWorkload,
    };
  });

  return result;
}

