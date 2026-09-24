package org.campus.classroom.mapper;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Options;
import org.campus.classroom.entity.ViolationRecord;

public interface ViolationRecordMapper {

    @Insert("""
            INSERT INTO violation_record (user_id, reservation_id, type, remark)
            VALUES (#{userId}, #{reservationId}, #{type}, #{remark})
            """)
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(ViolationRecord violationRecord);
}
