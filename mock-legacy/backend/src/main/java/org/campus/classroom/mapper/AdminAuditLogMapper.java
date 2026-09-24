package org.campus.classroom.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;
import org.campus.classroom.entity.AdminAuditLog;

import java.util.List;

public interface AdminAuditLogMapper {

    @Insert("""
            INSERT INTO admin_audit_log (
                admin_user_id,
                admin_username,
                action_type,
                target_type,
                target_id,
                target_name,
                detail,
                ip
            ) VALUES (
                #{adminUserId},
                #{adminUsername},
                #{actionType},
                #{targetType},
                #{targetId},
                #{targetName},
                #{detail},
                #{ip}
            )
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(AdminAuditLog auditLog);

    @Select("""
            <script>
            SELECT *
            FROM admin_audit_log
            <where>
                <if test="keyword != null and keyword != ''">
                    AND (
                        admin_username LIKE CONCAT('%', #{keyword}, '%')
                        OR target_name LIKE CONCAT('%', #{keyword}, '%')
                        OR detail LIKE CONCAT('%', #{keyword}, '%')
                    )
                </if>
                <if test="actionType != null and actionType != ''">
                    AND action_type = #{actionType}
                </if>
                <if test="targetType != null and targetType != ''">
                    AND target_type = #{targetType}
                </if>
            </where>
            ORDER BY create_time DESC, id DESC
            LIMIT #{limit}
            </script>
            """)
    @Results(id = "adminAuditLogResultMap", value = {
            @Result(column = "id", property = "id"),
            @Result(column = "admin_user_id", property = "adminUserId"),
            @Result(column = "admin_username", property = "adminUsername"),
            @Result(column = "action_type", property = "actionType"),
            @Result(column = "target_type", property = "targetType"),
            @Result(column = "target_id", property = "targetId"),
            @Result(column = "target_name", property = "targetName"),
            @Result(column = "detail", property = "detail"),
            @Result(column = "ip", property = "ip"),
            @Result(column = "create_time", property = "createTime")
    })
    List<AdminAuditLog> selectList(@Param("keyword") String keyword,
                                   @Param("actionType") String actionType,
                                   @Param("targetType") String targetType,
                                   @Param("limit") Integer limit);
}
