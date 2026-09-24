package org.campus.classroom.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Options;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.ResultMap;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;
import org.campus.classroom.entity.MaintenanceWindow;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface MaintenanceWindowMapper {
    @Insert("""
            INSERT INTO maintenance_window (
                resource_type, resource_id, classroom_id, start_time, end_time, reason, status, create_by
            )
            VALUES (
                #{resourceType}, #{resourceId}, #{classroomId}, #{startTime}, #{endTime}, #{reason}, #{status}, #{createBy}
            )
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(MaintenanceWindow maintenanceWindow);

    @Select("""
            SELECT *
            FROM maintenance_window
            WHERE id = #{id}
            """)
    @Results(id = "maintenanceWindowResultMap", value = {
            @Result(column = "id", property = "id"),
            @Result(column = "resource_type", property = "resourceType"),
            @Result(column = "resource_id", property = "resourceId"),
            @Result(column = "classroom_id", property = "classroomId"),
            @Result(column = "start_time", property = "startTime"),
            @Result(column = "end_time", property = "endTime"),
            @Result(column = "reason", property = "reason"),
            @Result(column = "status", property = "status"),
            @Result(column = "create_by", property = "createBy"),
            @Result(column = "create_time", property = "createTime"),
            @Result(column = "update_time", property = "updateTime")
    })
    MaintenanceWindow selectById(@Param("id") Long id);

    @Select("""
            <script>
            SELECT *
            FROM maintenance_window
            <where>
                <if test="status != null and status != ''">
                    AND status = #{status}
                </if>
                <if test="resourceType != null and resourceType != ''">
                    AND resource_type = #{resourceType}
                </if>
                <if test="classroomId != null">
                    AND classroom_id = #{classroomId}
                </if>
            </where>
            ORDER BY start_time DESC, id DESC
            </script>
            """)
    @ResultMap("maintenanceWindowResultMap")
    List<MaintenanceWindow> selectAdminList(@Param("status") String status,
                                            @Param("resourceType") String resourceType,
                                            @Param("classroomId") Long classroomId);

    @Update("""
            UPDATE maintenance_window
            SET status = 'CANCELLED'
            WHERE id = #{id}
              AND status = 'ACTIVE'
            """)
    int cancel(@Param("id") Long id);

    @Select("""
            SELECT *
            FROM maintenance_window
            WHERE status = 'ACTIVE'
              AND resource_type = 'CLASSROOM'
              AND resource_id = #{classroomId}
              AND start_time < #{endTime}
              AND end_time > #{startTime}
            FOR UPDATE
            """)
    @ResultMap("maintenanceWindowResultMap")
    List<MaintenanceWindow> selectClassroomConflictsForUpdate(@Param("classroomId") Long classroomId,
                                                              @Param("startTime") LocalDateTime startTime,
                                                              @Param("endTime") LocalDateTime endTime);

    @Select("""
            SELECT *
            FROM maintenance_window
            WHERE status = 'ACTIVE'
              AND resource_type = 'SEAT'
              AND resource_id = #{seatId}
              AND start_time < #{endTime}
              AND end_time > #{startTime}
            FOR UPDATE
            """)
    @ResultMap("maintenanceWindowResultMap")
    List<MaintenanceWindow> selectSeatConflictsForUpdate(@Param("seatId") Long seatId,
                                                         @Param("startTime") LocalDateTime startTime,
                                                         @Param("endTime") LocalDateTime endTime);

    @Select("""
            SELECT *
            FROM maintenance_window
            WHERE status = 'ACTIVE'
              AND classroom_id = #{classroomId}
              AND start_time < #{endTime}
              AND end_time > #{startTime}
            FOR UPDATE
            """)
    @ResultMap("maintenanceWindowResultMap")
    List<MaintenanceWindow> selectConflictsInClassroomForUpdate(@Param("classroomId") Long classroomId,
                                                                @Param("startTime") LocalDateTime startTime,
                                                                @Param("endTime") LocalDateTime endTime);

    @Select("""
            SELECT count(*)
            FROM maintenance_window
            WHERE status = 'ACTIVE'
              AND resource_type = 'CLASSROOM'
              AND resource_id = #{classroomId}
              AND start_time < #{endTime}
              AND end_time > #{startTime}
            """)
    int countClassroomConflicts(@Param("classroomId") Long classroomId,
                                @Param("startTime") LocalDateTime startTime,
                                @Param("endTime") LocalDateTime endTime);

    @Select("""
            SELECT DISTINCT resource_id
            FROM maintenance_window
            WHERE status = 'ACTIVE'
              AND resource_type = 'SEAT'
              AND classroom_id = #{classroomId}
              AND start_time < #{endTime}
              AND end_time > #{startTime}
            """)
    List<Long> selectMaintainedSeatIdsInClassroom(@Param("classroomId") Long classroomId,
                                                  @Param("startTime") LocalDateTime startTime,
                                                  @Param("endTime") LocalDateTime endTime);
}
