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
import org.campus.classroom.entity.WaitlistEntry;

import java.time.LocalDateTime;
import java.util.List;

@Mapper
public interface WaitlistEntryMapper {
    @Insert("""
            INSERT INTO waitlist_entry (
                user_id, seat_id, classroom_id, start_time, end_time, reason, status, promoted_reservation_id
            )
            VALUES (
                #{userId}, #{seatId}, #{classroomId}, #{startTime}, #{endTime}, #{reason}, #{status}, #{promotedReservationId}
            )
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(WaitlistEntry waitlistEntry);

    @Select("""
            SELECT *
            FROM waitlist_entry
            WHERE id = #{id}
            """)
    @Results(id = "waitlistEntryResultMap", value = {
            @Result(column = "id", property = "id"),
            @Result(column = "user_id", property = "userId"),
            @Result(column = "seat_id", property = "seatId"),
            @Result(column = "classroom_id", property = "classroomId"),
            @Result(column = "start_time", property = "startTime"),
            @Result(column = "end_time", property = "endTime"),
            @Result(column = "reason", property = "reason"),
            @Result(column = "status", property = "status"),
            @Result(column = "promoted_reservation_id", property = "promotedReservationId"),
            @Result(column = "create_time", property = "createTime"),
            @Result(column = "update_time", property = "updateTime")
    })
    WaitlistEntry selectById(@Param("id") Long id);

    @Select("""
            SELECT *
            FROM waitlist_entry
            WHERE id = #{id}
              AND user_id = #{userId}
            """)
    @ResultMap("waitlistEntryResultMap")
    WaitlistEntry selectByIdAndUserId(@Param("id") Long id, @Param("userId") Long userId);

    @Select("""
            SELECT *
            FROM waitlist_entry
            WHERE user_id = #{userId}
            ORDER BY create_time DESC, id DESC
            """)
    @ResultMap("waitlistEntryResultMap")
    List<WaitlistEntry> selectByUserId(@Param("userId") Long userId);

    @Select("""
            SELECT COUNT(*)
            FROM waitlist_entry
            WHERE user_id = #{userId}
              AND seat_id = #{seatId}
              AND start_time = #{startTime}
              AND end_time = #{endTime}
              AND status = 'WAITING'
            """)
    int countWaitingDuplicate(@Param("userId") Long userId,
                              @Param("seatId") Long seatId,
                              @Param("startTime") LocalDateTime startTime,
                              @Param("endTime") LocalDateTime endTime);

    @Select("""
            SELECT *
            FROM waitlist_entry
            WHERE seat_id = #{seatId}
              AND status = 'WAITING'
              AND start_time < #{releasedEndTime}
              AND end_time > #{releasedStartTime}
            ORDER BY create_time ASC, id ASC
            """)
    @ResultMap("waitlistEntryResultMap")
    List<WaitlistEntry> selectWaitingCandidatesForSeat(@Param("seatId") Long seatId,
                                                       @Param("releasedStartTime") LocalDateTime releasedStartTime,
                                                       @Param("releasedEndTime") LocalDateTime releasedEndTime);

    @Update("""
            UPDATE waitlist_entry
            SET status = 'CANCELLED'
            WHERE id = #{id}
              AND user_id = #{userId}
              AND status = 'WAITING'
            """)
    int cancelByIdAndUserId(@Param("id") Long id, @Param("userId") Long userId);

    @Update("""
            UPDATE waitlist_entry
            SET status = 'PROMOTED',
                promoted_reservation_id = #{reservationId}
            WHERE id = #{id}
              AND status = 'WAITING'
            """)
    int markPromoted(@Param("id") Long id, @Param("reservationId") Long reservationId);

    @Update("""
            UPDATE waitlist_entry
            SET status = 'EXPIRED'
            WHERE id = #{id}
              AND status = 'WAITING'
            """)
    int markExpired(@Param("id") Long id);

    @Update("""
            UPDATE waitlist_entry
            SET status = 'EXPIRED'
            WHERE status = 'WAITING'
              AND start_time <= #{now}
            """)
    int expireWaitingEntries(@Param("now") LocalDateTime now);
}
